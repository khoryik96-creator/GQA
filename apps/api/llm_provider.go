package main

import (
  "bytes"
  "context"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "os"
  "strings"
  "time"

  "github.com/anthropics/anthropic-sdk-go/v2"
  "github.com/anthropics/anthropic-sdk-go/v2/option"
)

// Supported model providers. DeepSeek, OpenAI and Gemini are called through
// their OpenAI-compatible chat completions endpoints; Claude is called through
// the official Anthropic SDK. "custom" keeps the original behaviour: any
// HTTPS OpenAI-compatible endpoint named by GQA_LLM_CHAT_COMPLETIONS_URL.
const (
  providerDeepSeek  = "deepseek"
  providerOpenAI    = "openai"
  providerGemini    = "gemini"
  providerAnthropic = "anthropic"
  providerCustom    = "custom"
)

type providerDefaults struct {
  URL   string
  Model string
}

// Default models are deliberately overridable with GQA_LLM_MODEL. Gemini has
// no default model because its published model IDs change frequently.
var knownProviders = map[string]providerDefaults{
  providerDeepSeek:  {URL: "https://api.deepseek.com/chat/completions", Model: "deepseek-v4-flash"},
  providerOpenAI:    {URL: "https://api.openai.com/v1/chat/completions", Model: "gpt-5.6-terra"},
  providerGemini:    {URL: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"},
  providerAnthropic: {URL: "https://api.anthropic.com", Model: "claude-opus-5-5"},
}

// planningProvider is one configured model endpoint. An empty Kind means an
// OpenAI-compatible endpoint, which keeps older configurations and tests valid.
type planningProvider struct {
  Kind   string
  URL    string
  Model  string
  Key    string
  Client *http.Client
}

func normalizeProviderName(raw string) string {
  name := strings.ToLower(strings.TrimSpace(raw))
  switch name {
  case "claude":
    return providerAnthropic
  case "gpt", "chatgpt":
    return providerOpenAI
  case "google":
    return providerGemini
  }
  return name
}

// providerFromEnvironment resolves the configured provider. Sending project
// context to any third party still requires GQA_LLM_SEND_PROJECT_CONTEXT=true.
//
//   GQA_LLM_PROVIDER = deepseek (default) | openai | gemini | anthropic | custom
//   GQA_LLM_API_KEY  = provider API key (required)
//   GQA_LLM_MODEL    = optional override of the provider's default model
//   GQA_LLM_CHAT_COMPLETIONS_URL = optional endpoint override (required for custom)
func providerFromEnvironment() (planningProvider, bool) {
  p, err := resolveProvider(os.Getenv("GQA_LLM_PROVIDER"), os.Getenv("GQA_LLM_CHAT_COMPLETIONS_URL"),
    os.Getenv("GQA_LLM_MODEL"), os.Getenv("GQA_LLM_API_KEY"))
  if err != nil || os.Getenv("GQA_LLM_SEND_PROJECT_CONTEXT") != "true" {
    return p, false
  }
  return p, true
}

func resolveProvider(name, endpoint, model, key string) (planningProvider, error) {
  kind := normalizeProviderName(name)
  endpoint = strings.TrimSpace(endpoint)
  if kind == "" {
    // Older deployments configured only an endpoint URL; treat that as custom.
    if endpoint != "" {
      kind = providerCustom
    } else {
      kind = providerDeepSeek
    }
  }
  p := planningProvider{
    Kind: kind, URL: endpoint, Model: strings.TrimSpace(model), Key: strings.TrimSpace(key),
    Client: &http.Client{Timeout: 18 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
  }
  if kind != providerCustom {
    defaults, ok := knownProviders[kind]
    if !ok {
      return p, fmt.Errorf("unknown GQA_LLM_PROVIDER %q", name)
    }
    if p.URL == "" {
      p.URL = defaults.URL
    }
    if p.Model == "" {
      p.Model = defaults.Model
    }
  }
  if p.URL == "" || p.Model == "" || p.Key == "" {
    return p, errors.New("model provider requires an endpoint, model and API key")
  }
  u, err := url.Parse(p.URL)
  if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
    return p, errors.New("model provider endpoint must be an HTTPS URL without credentials")
  }
  return p, nil
}

// Label is a stable identifier stored with model-generated results.
func (p planningProvider) Label() string {
  kind := p.Kind
  if kind == "" {
    kind = providerCustom
  }
  return kind + "/" + p.Model
}

type completionRequest struct {
  System    string
  User      string
  MaxTokens int
  // JSON asks OpenAI-compatible providers for a JSON object response.
  JSON bool
  // Deep requests more careful reasoning on providers that support it.
  Deep bool
}

type chatMessage struct {
  Role    string `json:"role"`
  Content string `json:"content"`
}

// complete sends one system+user exchange and returns the model's text.
// Callers are responsible for strict validation of the returned text.
func (p planningProvider) complete(ctx context.Context, req completionRequest) (string, error) {
  if req.MaxTokens <= 0 {
    req.MaxTokens = 4000
  }
  if p.Kind == providerAnthropic {
    return p.completeAnthropic(ctx, req)
  }
  return p.completeChat(ctx, req)
}

func (p planningProvider) completeChat(ctx context.Context, req completionRequest) (string, error) {
  body := map[string]any{
    "model":    p.Model,
    "messages": []chatMessage{{Role: "system", Content: req.System}, {Role: "user", Content: req.User}},
  }
  switch p.Kind {
  case providerOpenAI:
    // Current OpenAI reasoning models reject non-default temperature.
    body["max_completion_tokens"] = req.MaxTokens
  case providerGemini:
    body["max_tokens"] = req.MaxTokens
  default:
    body["temperature"] = 0.2
    body["max_tokens"] = req.MaxTokens
  }
  if req.JSON && p.Kind != "" && p.Kind != providerCustom {
    body["response_format"] = map[string]string{"type": "json_object"}
  }
  data, _ := json.Marshal(body)
  httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.URL, bytes.NewReader(data))
  if err != nil {
    return "", err
  }
  httpReq.Header.Set("Authorization", "Bearer "+p.Key)
  httpReq.Header.Set("Content-Type", "application/json")
  client := p.Client
  if client == nil {
    client = &http.Client{Timeout: 18 * time.Second}
  }
  resp, err := client.Do(httpReq)
  if err != nil {
    return "", err
  }
  defer resp.Body.Close()
  if resp.StatusCode != http.StatusOK {
    return "", fmt.Errorf("model provider HTTP %d", resp.StatusCode)
  }
  var envelope struct {
    Choices []struct {
      Message struct {
        Content string `json:"content"`
      } `json:"message"`
      FinishReason string `json:"finish_reason"`
    } `json:"choices"`
  }
  if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<10)).Decode(&envelope); err != nil {
    return "", err
  }
  if len(envelope.Choices) != 1 {
    return "", errors.New("unexpected provider choices")
  }
  if envelope.Choices[0].FinishReason == "length" {
    return "", errors.New("model output was truncated")
  }
  return strings.TrimSpace(envelope.Choices[0].Message.Content), nil
}

func (p planningProvider) completeAnthropic(ctx context.Context, req completionRequest) (string, error) {
  // The base URL is always explicit so ANTHROPIC_BASE_URL in the API
  // container cannot silently redirect project context elsewhere.
  opts := []option.RequestOption{option.WithAPIKey(p.Key), option.WithBaseURL(p.URL), option.WithMaxRetries(2)}
  if p.Client != nil {
    opts = append(opts, option.WithHTTPClient(p.Client))
  }
  client := anthropic.NewClient(opts...)
  effort := anthropic.BetaOutputConfigEffortMedium
  if req.Deep {
    effort = anthropic.BetaOutputConfigEffortHigh
  }
  params := anthropic.BetaMessageNewParams{
    Model:        anthropic.Model(p.Model),
    MaxTokens:    int64(req.MaxTokens),
    System:       []anthropic.BetaTextBlockParam{{Text: req.System}},
    Messages:     []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(req.User))},
    OutputConfig: anthropic.BetaOutputConfigParam{Effort: effort},
    // A policy decline is re-served by a fallback model inside the same call.
    Fallbacks: anthropic.BetaFallbacksParamOfDefault(),
    Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
  }
  // Streaming avoids HTTP timeouts on long code-review responses.
  stream := client.Beta.Messages.NewStreaming(ctx, params)
  message := anthropic.BetaMessage{}
  for stream.Next() {
    if err := message.Accumulate(stream.Current()); err != nil {
      return "", err
    }
  }
  if err := stream.Err(); err != nil {
    var apiErr *anthropic.Error
    if errors.As(err, &apiErr) {
      return "", fmt.Errorf("model provider HTTP %d", apiErr.StatusCode)
    }
    return "", err
  }
  switch message.StopReason {
  case anthropic.BetaStopReasonRefusal:
    return "", errors.New("model declined the request")
  case anthropic.BetaStopReasonMaxTokens:
    return "", errors.New("model output was truncated")
  }
  var out strings.Builder
  for _, block := range message.Content {
    if text, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
      out.WriteString(text.Text)
    }
  }
  return strings.TrimSpace(out.String()), nil
}

// stripCodeFence removes one surrounding Markdown code fence, which some
// providers add even when asked for raw JSON. Content is not otherwise altered.
func stripCodeFence(raw string) string {
  s := strings.TrimSpace(raw)
  if !strings.HasPrefix(s, "```") || !strings.HasSuffix(s, "```") || len(s) < 6 {
    return s
  }
  s = strings.TrimSuffix(strings.TrimPrefix(s, "```"), "```")
  if nl := strings.IndexByte(s, '\n'); nl >= 0 && !strings.ContainsAny(s[:nl], "{[") {
    s = s[nl+1:]
  }
  return strings.TrimSpace(s)
}
