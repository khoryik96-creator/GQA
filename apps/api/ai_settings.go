package main

import (
  "context"
  "crypto/aes"
  "crypto/cipher"
  "crypto/rand"
  "crypto/sha256"
  "encoding/json"
  "errors"
  "io"
  "log"
  "net/http"
  "os"
  "strings"
  "time"
  "unicode"

  "github.com/jackc/pgx/v5"
  "github.com/jackc/pgx/v5/pgxpool"
)

// AI provider settings entered by an administrator in the dashboard.
//
// API keys are encrypted with AES-256-GCM using a key derived from
// GQA_SECRETS_KEY, which lives only in the API container's environment.
// The database alone (or a backup of it) is not enough to recover a key,
// and keys are never returned by the API: only the last four characters.
// When no settings have been saved, GQA falls back to the GQA_LLM_*
// environment variables.

var settingsProviders = []string{providerDeepSeek, providerOpenAI, providerGemini, providerAnthropic, providerCustom}

// activeProvider resolves the provider for planning, flow drafting and code
// review. main() replaces it with the database-backed resolver.
var activeProvider = func(ctx context.Context) (planningProvider, bool) { return providerFromEnvironment() }

type secretBox struct{ aead cipher.AEAD }

var errSecretsKeyMissing = errors.New("GQA_SECRETS_KEY is not set (32+ characters); API keys cannot be stored")

func newSecretBox(secret string) (*secretBox, error) {
  secret = strings.TrimSpace(secret)
  if len(secret) < 32 {
    return nil, errSecretsKeyMissing
  }
  key := sha256.Sum256([]byte("gqa-ai-provider-keys-v1\x00" + secret))
  block, err := aes.NewCipher(key[:])
  if err != nil {
    return nil, err
  }
  aead, err := cipher.NewGCM(block)
  if err != nil {
    return nil, err
  }
  return &secretBox{aead: aead}, nil
}

// seal binds the ciphertext to its provider name, so a stored key cannot be
// moved to another provider's row and still decrypt.
func (b *secretBox) seal(provider, plaintext string) ([]byte, error) {
  nonce := make([]byte, b.aead.NonceSize())
  if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
    return nil, err
  }
  return b.aead.Seal(nonce, nonce, []byte(plaintext), []byte(provider)), nil
}

func (b *secretBox) open(provider string, sealed []byte) (string, error) {
  n := b.aead.NonceSize()
  if len(sealed) < n+b.aead.Overhead() {
    return "", errors.New("stored key is corrupt")
  }
  plain, err := b.aead.Open(nil, sealed[:n], sealed[n:], []byte(provider))
  if err != nil {
    return "", errors.New("stored key cannot be decrypted with the current GQA_SECRETS_KEY")
  }
  return string(plain), nil
}

func secretBoxFromEnvironment() (*secretBox, error) { return newSecretBox(os.Getenv("GQA_SECRETS_KEY")) }

func validAPIKey(key string) bool {
  if len(key) < 8 || len(key) > 500 {
    return false
  }
  for _, r := range key {
    if unicode.IsSpace(r) || unicode.IsControl(r) || r > unicode.MaxASCII {
      return false
    }
  }
  return true
}

func keyHint(key string) string {
  if len(key) < 8 {
    return ""
  }
  return key[len(key)-4:]
}

type storedProvider struct {
  Sealed   []byte
  KeyHint  string
  Model    string
  Endpoint string
}

type aiSettingsStore struct{ db *pgxpool.Pool }

func (s aiSettingsStore) load(ctx context.Context) (provider string, sendContext bool, found bool, err error) {
  err = s.db.QueryRow(ctx, "SELECT provider,send_project_context FROM ai_settings WHERE id=1").Scan(&provider, &sendContext)
  if errors.Is(err, pgx.ErrNoRows) {
    return "", false, false, nil
  }
  return provider, sendContext, err == nil, err
}

func (s aiSettingsStore) providers(ctx context.Context) (map[string]storedProvider, error) {
  rows, err := s.db.Query(ctx, "SELECT provider,api_key_ciphertext,key_hint,model,endpoint FROM ai_provider_credentials")
  if err != nil {
    return nil, err
  }
  defer rows.Close()
  out := map[string]storedProvider{}
  for rows.Next() {
    var name string
    var p storedProvider
    if err := rows.Scan(&name, &p.Sealed, &p.KeyHint, &p.Model, &p.Endpoint); err != nil {
      return nil, err
    }
    out[name] = p
  }
  return out, rows.Err()
}

// envProviderName is the provider the GQA_LLM_* variables describe.
func envProviderName() string {
  name := normalizeProviderName(os.Getenv("GQA_LLM_PROVIDER"))
  if name == "" {
    if strings.TrimSpace(os.Getenv("GQA_LLM_CHAT_COMPLETIONS_URL")) != "" {
      return providerCustom
    }
    return providerDeepSeek
  }
  return name
}

// resolveFromSettings builds the active provider from saved settings. A key
// saved in the dashboard wins; otherwise the environment key is used when it
// belongs to the same provider.
func (s aiSettingsStore) resolve(ctx context.Context) (planningProvider, bool, bool) {
  name, sendContext, found, err := s.load(ctx)
  if err != nil {
    log.Printf("AI settings: %v", err)
    return planningProvider{}, false, true
  }
  if !found {
    return planningProvider{}, false, false
  }
  stored, err := s.providers(ctx)
  if err != nil {
    log.Printf("AI settings: %v", err)
    return planningProvider{}, false, true
  }
  box, boxErr := secretBoxFromEnvironment()
  p, ready := resolveStoredProvider(name, sendContext, stored[name], box, boxErr)
  return p, ready, true
}

// resolveStoredProvider combines saved settings with the environment. A key
// saved in the dashboard wins. If a saved key cannot be decrypted, AI stays
// off: the environment key is used only when no key was saved at all, so a
// lost GQA_SECRETS_KEY never silently switches to a different credential.
func resolveStoredProvider(name string, sendContext bool, row storedProvider, box *secretBox, boxErr error) (planningProvider, bool) {
  key := ""
  if len(row.Sealed) > 0 {
    err := boxErr
    if err == nil {
      key, err = box.open(name, row.Sealed)
    }
    if err != nil {
      log.Printf("AI settings: %s key unavailable, AI features disabled: %v", name, err)
      return planningProvider{Kind: name}, false
    }
  }
  envMatches := envProviderName() == name
  if key == "" && envMatches {
    key = os.Getenv("GQA_LLM_API_KEY")
  }
  model, endpoint := row.Model, row.Endpoint
  if model == "" && envMatches {
    model = os.Getenv("GQA_LLM_MODEL")
  }
  if endpoint == "" && envMatches {
    endpoint = os.Getenv("GQA_LLM_CHAT_COMPLETIONS_URL")
  }
  p, err := resolveProvider(name, endpoint, model, key)
  return p, err == nil && sendContext
}

func (s *server) providerFromSettings(ctx context.Context) (planningProvider, bool) {
  p, ready, found := aiSettingsStore{s.db}.resolve(ctx)
  if !found {
    return providerFromEnvironment()
  }
  return p, ready
}

// --- HTTP API -------------------------------------------------------------

type providerSettingsView struct {
  Provider     string `json:"provider"`
  KeyConfigured bool  `json:"key_configured"`
  KeyHint      string `json:"key_hint"`
  KeySource    string `json:"key_source"`
  // KeyUnreadable means a key is saved but cannot be decrypted with the
  // current GQA_SECRETS_KEY, so it must be entered again.
  KeyUnreadable bool `json:"key_unreadable"`
  Model        string `json:"model"`
  DefaultModel string `json:"default_model"`
  Endpoint     string `json:"endpoint"`
  DefaultEndpoint string `json:"default_endpoint"`
}

type aiSettingsView struct {
  Source              string                 `json:"source"`
  Provider            string                 `json:"provider"`
  SendProjectContext  bool                   `json:"send_project_context"`
  Ready               bool                   `json:"ready"`
  ActiveLabel         string                 `json:"active_label"`
  EncryptionAvailable bool                   `json:"encryption_available"`
  Providers           []providerSettingsView `json:"providers"`
  UpdatedAt           *time.Time             `json:"updated_at,omitempty"`
}

func (s *server) aiSettingsView(ctx context.Context) (aiSettingsView, error) {
  store := aiSettingsStore{s.db}
  name, sendContext, found, err := store.load(ctx)
  if err != nil {
    return aiSettingsView{}, err
  }
  stored, err := store.providers(ctx)
  if err != nil {
    return aiSettingsView{}, err
  }
  view := aiSettingsView{Source: "environment", Providers: []providerSettingsView{}}
  box, boxErr := secretBoxFromEnvironment()
  view.EncryptionAvailable = boxErr == nil
  if found {
    view.Source = "dashboard"
    view.Provider = name
    view.SendProjectContext = sendContext
    var updated time.Time
    if s.db.QueryRow(ctx, "SELECT updated_at FROM ai_settings WHERE id=1").Scan(&updated) == nil {
      view.UpdatedAt = &updated
    }
  } else {
    view.Provider = envProviderName()
    view.SendProjectContext = os.Getenv("GQA_LLM_SEND_PROJECT_CONTEXT") == "true"
  }
  envName := envProviderName()
  envKey := strings.TrimSpace(os.Getenv("GQA_LLM_API_KEY")) != ""
  for _, p := range settingsProviders {
    row := stored[p]
    item := providerSettingsView{Provider: p, Model: row.Model, Endpoint: row.Endpoint,
      DefaultModel: knownProviders[p].Model, DefaultEndpoint: knownProviders[p].URL}
    if len(row.Sealed) > 0 {
      item.KeyConfigured, item.KeyHint, item.KeySource = true, row.KeyHint, "dashboard"
      if boxErr != nil {
        item.KeyUnreadable = true
      } else if _, err := box.open(p, row.Sealed); err != nil {
        item.KeyUnreadable = true
      }
    } else if envKey && envName == p {
      item.KeyConfigured, item.KeySource = true, "environment"
    }
    view.Providers = append(view.Providers, item)
  }
  active, ready := activeProvider(ctx)
  view.Ready = ready
  if ready {
    view.ActiveLabel = active.Label()
  }
  return view, nil
}

func (s *server) getAISettings(w http.ResponseWriter, r *http.Request) {
  view, err := s.aiSettingsView(r.Context())
  if err != nil {
    fail(w, 500, "Could not load AI settings")
    return
  }
  writeJSON(w, 200, view)
}

type providerUpdate struct {
  APIKey   *string `json:"api_key"`
  ClearKey bool    `json:"clear_key"`
  Model    *string `json:"model"`
  Endpoint *string `json:"endpoint"`
}

type aiSettingsUpdate struct {
  Provider           string                    `json:"provider"`
  SendProjectContext bool                      `json:"send_project_context"`
  Providers          map[string]providerUpdate `json:"providers"`
}

func validModelName(m string) bool {
  if len(m) > 200 {
    return false
  }
  for _, r := range m {
    if !(unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("-._:/@", r)) {
      return false
    }
  }
  return true
}

func (s *server) saveAISettings(w http.ResponseWriter, r *http.Request) {
  account, _ := currentAccount(r)
  var body aiSettingsUpdate
  decoder := json.NewDecoder(io.LimitReader(r.Body, 32<<10))
  decoder.DisallowUnknownFields()
  if err := decoder.Decode(&body); err != nil {
    fail(w, 400, "Invalid JSON body")
    return
  }
  body.Provider = normalizeProviderName(body.Provider)
  if !isOneOf(body.Provider, settingsProviders...) {
    fail(w, 400, "Unknown provider")
    return
  }
  var box *secretBox
  for name, update := range body.Providers {
    if !isOneOf(name, settingsProviders...) {
      fail(w, 400, "Unknown provider: "+name)
      return
    }
    if update.APIKey != nil {
      key := strings.TrimSpace(*update.APIKey)
      if key != "" && !validAPIKey(key) {
        fail(w, 400, "The "+name+" API key looks invalid (8–500 printable characters, no spaces)")
        return
      }
      if key != "" && box == nil {
        b, err := secretBoxFromEnvironment()
        if err != nil {
          fail(w, 409, err.Error())
          return
        }
        box = b
      }
    }
    if update.Model != nil && !validModelName(strings.TrimSpace(*update.Model)) {
      fail(w, 400, "Invalid model name for "+name)
      return
    }
    if update.Endpoint != nil {
      if e := strings.TrimSpace(*update.Endpoint); e != "" {
        if _, err := resolveProvider(providerCustom, e, "m", "placeholder-key"); err != nil {
          fail(w, 400, "Endpoint for "+name+" must be an HTTPS URL without credentials")
          return
        }
      }
    }
  }
  tx, err := s.db.Begin(r.Context())
  if err != nil {
    fail(w, 500, "Could not save AI settings")
    return
  }
  defer tx.Rollback(r.Context())
  audit := func(action, provider string) error {
    _, err := tx.Exec(r.Context(), `INSERT INTO ai_settings_audit(actor_id,action,provider) VALUES($1::uuid,$2,$3)`,
      account.ID, action, provider)
    return err
  }
  var previous string
  _ = tx.QueryRow(r.Context(), "SELECT provider FROM ai_settings WHERE id=1").Scan(&previous)
  if _, err = tx.Exec(r.Context(), `INSERT INTO ai_settings(id,provider,send_project_context,updated_by,updated_at)
      VALUES(1,$1,$2,$3::uuid,now())
      ON CONFLICT(id) DO UPDATE SET provider=EXCLUDED.provider,send_project_context=EXCLUDED.send_project_context,
        updated_by=EXCLUDED.updated_by,updated_at=now()`, body.Provider, body.SendProjectContext, account.ID); err != nil {
    fail(w, 500, "Could not save AI settings")
    return
  }
  if err = audit("settings_saved", body.Provider); err != nil {
    fail(w, 500, "Could not save AI settings")
    return
  }
  if previous != "" && previous != body.Provider {
    if err = audit("provider_changed", body.Provider); err != nil {
      fail(w, 500, "Could not save AI settings")
      return
    }
  }
  for name, update := range body.Providers {
    if _, err = tx.Exec(r.Context(), `INSERT INTO ai_provider_credentials(provider,updated_by) VALUES($1,$2::uuid)
        ON CONFLICT(provider) DO NOTHING`, name, account.ID); err != nil {
      break
    }
    if update.Model != nil {
      if _, err = tx.Exec(r.Context(), `UPDATE ai_provider_credentials SET model=$2,updated_by=$3::uuid,updated_at=now() WHERE provider=$1`,
        name, strings.TrimSpace(*update.Model), account.ID); err != nil {
        break
      }
    }
    if update.Endpoint != nil {
      if _, err = tx.Exec(r.Context(), `UPDATE ai_provider_credentials SET endpoint=$2,updated_by=$3::uuid,updated_at=now() WHERE provider=$1`,
        name, strings.TrimSpace(*update.Endpoint), account.ID); err != nil {
        break
      }
    }
    key := ""
    if update.APIKey != nil {
      key = strings.TrimSpace(*update.APIKey)
    }
    switch {
    case key != "":
      var sealed []byte
      if sealed, err = box.seal(name, key); err != nil {
        break
      }
      if _, err = tx.Exec(r.Context(), `UPDATE ai_provider_credentials SET api_key_ciphertext=$2,key_hint=$3,updated_by=$4::uuid,updated_at=now()
          WHERE provider=$1`, name, sealed, keyHint(key), account.ID); err == nil {
        err = audit("key_saved", name)
      }
    case update.ClearKey:
      if _, err = tx.Exec(r.Context(), `UPDATE ai_provider_credentials SET api_key_ciphertext=NULL,key_hint='',updated_by=$2::uuid,updated_at=now()
          WHERE provider=$1`, name, account.ID); err == nil {
        err = audit("key_cleared", name)
      }
    }
    if err != nil {
      break
    }
  }
  if err != nil {
    log.Printf("AI settings save: %v", err)
    fail(w, 500, "Could not save AI settings")
    return
  }
  if err = tx.Commit(r.Context()); err != nil {
    fail(w, 500, "Could not save AI settings")
    return
  }
  s.getAISettings(w, r)
}

// testAISettings sends one tiny request to the active provider so an
// administrator can confirm the key, model and endpoint work.
func (s *server) testAISettings(w http.ResponseWriter, r *http.Request) {
  provider, ready := activeProvider(r.Context())
  if !ready {
    fail(w, 409, "Select a provider, enter its API key and allow sending project context before testing")
    return
  }
  ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
  defer cancel()
  provider.Client = &http.Client{Timeout: 40 * time.Second,
    CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
  started := time.Now()
  out, err := provider.complete(ctx, completionRequest{
    System:    `You are a connectivity check. Reply with exactly this JSON object and nothing else: {"ok":true}`,
    User:      "ping",
    MaxTokens: 400,
    JSON:      true,
  })
  result := map[string]any{"provider": provider.Label(), "latency_ms": time.Since(started).Milliseconds()}
  if err != nil {
    result["ok"], result["error"] = false, err.Error()
    writeJSON(w, 200, result)
    return
  }
  var parsed struct {
    OK bool `json:"ok"`
  }
  result["ok"] = json.Unmarshal([]byte(stripCodeFence(out)), &parsed) == nil && parsed.OK
  if result["ok"] == false {
    result["error"] = "The provider answered, but not with the expected JSON. The model may not follow JSON instructions."
  }
  writeJSON(w, 200, result)
}
