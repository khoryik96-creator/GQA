package main

import (
  "bytes"
  "strings"
  "testing"
)

const testSecret = "0123456789abcdef0123456789abcdef-test"

func TestSecretBoxRoundTripAndBinding(t *testing.T) {
  box, err := newSecretBox(testSecret)
  if err != nil {
    t.Fatal(err)
  }
  sealed, err := box.seal("deepseek", "sk-test-1234567890")
  if err != nil {
    t.Fatal(err)
  }
  if bytes.Contains(sealed, []byte("sk-test")) {
    t.Fatal("ciphertext contains plaintext")
  }
  again, _ := box.seal("deepseek", "sk-test-1234567890")
  if bytes.Equal(sealed, again) {
    t.Fatal("nonce must differ between encryptions")
  }
  plain, err := box.open("deepseek", sealed)
  if err != nil || plain != "sk-test-1234567890" {
    t.Fatalf("round trip failed: %q %v", plain, err)
  }
  if _, err := box.open("openai", sealed); err == nil {
    t.Fatal("ciphertext must not decrypt under another provider name")
  }
  other, _ := newSecretBox(strings.Repeat("z", 40))
  if _, err := other.open("deepseek", sealed); err == nil {
    t.Fatal("ciphertext must not decrypt with another secret")
  }
  tampered := append([]byte{}, sealed...)
  tampered[len(tampered)-1] ^= 1
  if _, err := box.open("deepseek", tampered); err == nil {
    t.Fatal("tampered ciphertext must be rejected")
  }
  if _, err := box.open("deepseek", sealed[:10]); err == nil {
    t.Fatal("truncated ciphertext must be rejected")
  }
}

func TestSecretBoxRequiresLongSecret(t *testing.T) {
  if _, err := newSecretBox("short"); err == nil {
    t.Fatal("short secret must be rejected")
  }
  if _, err := newSecretBox("   "); err == nil {
    t.Fatal("blank secret must be rejected")
  }
  t.Setenv("GQA_SECRETS_KEY", "")
  if _, err := secretBoxFromEnvironment(); err != errSecretsKeyMissing {
    t.Fatalf("expected missing-key error, got %v", err)
  }
}

func TestAPIKeyValidationAndHint(t *testing.T) {
  for _, good := range []string{"sk-abcdef123456", "AIzaSyD-abc_def.123", "sk-ant-api03-xyz-1234"} {
    if !validAPIKey(good) {
      t.Fatalf("rejected %q", good)
    }
  }
  for _, bad := range []string{"short", "has space inside-key", "tab\tkey12345", "ключ-ключ-ключ", strings.Repeat("a", 501)} {
    if validAPIKey(bad) {
      t.Fatalf("accepted %q", bad)
    }
  }
  if keyHint("sk-abcdef123456") != "3456" || keyHint("abc") != "" {
    t.Fatal("unexpected key hint")
  }
}

func TestModelNameValidation(t *testing.T) {
  for _, good := range []string{"", "deepseek-v4-flash", "gpt-5.6-terra", "claude-opus-5-5", "models/gemini-x", "org/model:tag"} {
    if !validModelName(good) {
      t.Fatalf("rejected %q", good)
    }
  }
  for _, bad := range []string{"model name", "m;drop", "m\nx", strings.Repeat("m", 201)} {
    if validModelName(bad) {
      t.Fatalf("accepted %q", bad)
    }
  }
}

func TestEnvProviderName(t *testing.T) {
  t.Setenv("GQA_LLM_PROVIDER", "")
  t.Setenv("GQA_LLM_CHAT_COMPLETIONS_URL", "")
  if envProviderName() != providerDeepSeek {
    t.Fatal("default should be deepseek")
  }
  t.Setenv("GQA_LLM_CHAT_COMPLETIONS_URL", "https://llm.example/v1/chat/completions")
  if envProviderName() != providerCustom {
    t.Fatal("endpoint-only should be custom")
  }
  t.Setenv("GQA_LLM_PROVIDER", "claude")
  if envProviderName() != providerAnthropic {
    t.Fatal("alias should normalize")
  }
}
