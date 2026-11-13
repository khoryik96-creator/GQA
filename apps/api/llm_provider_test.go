package main

import (
  "context"
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "net/http/httptest"
  "strings"
  "testing"
)

func TestResolveProviderDefaultsToDeepSeek(t *testing.T) {
  p, err := resolveProvider("", "", "", "key")
  if err != nil {
    t.Fatal(err)
  }
  if p.Kind != providerDeepSeek || p.URL != "https://api.deepseek.com/chat/completions" || p.Model != "deepseek-v4-flash" {
    t.Fatalf("unexpected default provider: %+v", p)
  }
  if p.Label() != "deepseek/deepseek-v4-flash" {
    t.Fatalf("label %q", p.Label())
  }
}

func TestResolveProviderAliasesAndOverrides(t *testing.T) {
  cases := []struct{ name, model, kind, wantModel string }{
    {"claude", "", providerAnthropic, "claude-opus-5-5"},
    {"Anthropic", "claude-sonnet-5-5", providerAnthropic, "claude-sonnet-5-5"},
    {"gpt", "", providerOpenAI, "gpt-5.6-terra"},
    {"gemini", "gemini-x", providerGemini, "gemini-x"},
    {"deepseek", "deepseek-v4-pro", providerDeepSeek, "deepseek-v4-pro"},
  }
  for _, c := range cases {
    p, err := resolveProvider(c.name, "", c.model, "key")
    if err != nil {
      t.Fatalf("%s: %v", c.name, err)
    }
    if p.Kind != c.kind || p.Model != c.wantModel {
      t.Fatalf("%s: got %+v", c.name, p)
    }
  }
}

func TestResolveProviderRejectsUnsafeOrIncompleteConfiguration(t *testing.T) {
  bad := []struct{ name, endpoint, model, key string }{
    {"deepseek", "", "", ""},                                  // no key
    {"gemini", "", "", "key"},                                 // gemini needs an explicit model
    {"custom", "", "m", "key"},                                // custom needs an endpoint
    {"custom", "http://insecure.example/v1", "m", "key"},      // plain HTTP
    {"custom", "https://user:pw@example.com/v1", "m", "key"},  // embedded credentials
    {"mystery", "", "m", "key"},                               // unknown provider
  }
  for _, b := range bad {
    if _, err := resolveProvider(b.name, b.endpoint, b.model, b.key); err == nil {
      t.Fatalf("expected rejection for %+v", b)
    }
  }
}

func TestLegacyEndpointOnlyConfigurationIsCustom(t *testing.T) {
  p, err := resolveProvider("", "https://llm.internal.example/v1/chat/completions", "local-model", "key")
  if err != nil || p.Kind != providerCustom {
    t.Fatalf("legacy endpoint should resolve as custom: %+v %v", p, err)
  }
}

func TestProviderFromEnvironmentRequiresExplicitContextConsent(t *testing.T) {
  t.Setenv("GQA_LLM_PROVIDER", "deepseek")
  t.Setenv("GQA_LLM_API_KEY", "key")
  t.Setenv("GQA_LLM_MODEL", "")
  t.Setenv("GQA_LLM_CHAT_COMPLETIONS_URL", "")
  t.Setenv("GQA_LLM_SEND_PROJECT_CONTEXT", "false")
  if _, ok := providerFromEnvironment(); ok {
    t.Fatal("provider must stay disabled without context consent")
  }
  t.Setenv("GQA_LLM_SEND_PROJECT_CONTEXT", "true")
  if _, ok := providerFromEnvironment(); !ok {
    t.Fatal("provider should be enabled")
  }
}

func TestChatCompletionRequestShapePerProvider(t *testing.T) {
  for _, kind := range []string{providerDeepSeek, providerOpenAI, providerGemini, providerCustom} {
    var got map[string]any
    var auth string
    server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
      auth = r.Header.Get("Authorization")
      _ = json.NewDecoder(r.Body).Decode(&got)
      fmt.Fprint(w, `{"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}`)
    }))
    p := planningProvider{Kind: kind, URL: server.URL, Model: "m", Key: "secret", Client: server.Client()}
    out, err := p.complete(context.Background(), completionRequest{System: "s", User: "u", MaxTokens: 123, JSON: true})
    server.Close()
    if err != nil || out != `{"ok":true}` {
      t.Fatalf("%s: %q %v", kind, out, err)
    }
    if auth != "Bearer secret" {
      t.Fatalf("%s: auth header %q", kind, auth)
    }
    _, hasTemp := got["temperature"]
    _, hasFormat := got["response_format"]
    switch kind {
    case providerOpenAI:
      if hasTemp || got["max_completion_tokens"] != float64(123) || !hasFormat {
        t.Fatalf("openai body: %v", got)
      }
    case providerCustom:
      if !hasTemp || hasFormat || got["max_tokens"] != float64(123) {
        t.Fatalf("custom body: %v", got)
      }
    case providerDeepSeek:
      if !hasTemp || !hasFormat || got["max_tokens"] != float64(123) {
        t.Fatalf("deepseek body: %v", got)
      }
    case providerGemini:
      if hasTemp || !hasFormat || got["max_tokens"] != float64(123) {
        t.Fatalf("gemini body: %v", got)
      }
    }
  }
}

func TestChatCompletionRejectsTruncatedOutputAndErrors(t *testing.T) {
  server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if strings.Contains(r.URL.Path, "fail") {
      w.WriteHeader(500)
      return
    }
    fmt.Fprint(w, `{"choices":[{"message":{"content":"{"},"finish_reason":"length"}]}`)
  }))
  defer server.Close()
  p := planningProvider{Kind: providerDeepSeek, URL: server.URL, Model: "m", Key: "k", Client: server.Client()}
  if _, err := p.complete(context.Background(), completionRequest{System: "s", User: "u"}); err == nil {
    t.Fatal("truncated output must fail")
  }
  p.URL = server.URL + "/fail"
  if _, err := p.complete(context.Background(), completionRequest{System: "s", User: "u"}); err == nil {
    t.Fatal("HTTP 500 must fail")
  }
}

func sse(w io.Writer, event string, data string) {
  fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

func TestAnthropicProviderUsesMessagesAPI(t *testing.T) {
  var got map[string]any
  var headers http.Header
  server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path != "/v1/messages" {
      t.Errorf("unexpected path %s", r.URL.Path)
    }
    headers = r.Header.Clone()
    _ = json.NewDecoder(r.Body).Decode(&got)
    w.Header().Set("Content-Type", "text/event-stream")
    sse(w, "message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":5,"output_tokens":0}}}`)
    sse(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
    sse(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"summary\":"}}`)
    sse(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\"ok\"}"}}`)
    sse(w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
    sse(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`)
    sse(w, "message_stop", `{"type":"message_stop"}`)
  }))
  defer server.Close()
  p := planningProvider{Kind: providerAnthropic, URL: server.URL, Model: "claude-opus-5-5", Key: "ak", Client: server.Client()}
  out, err := p.complete(context.Background(), completionRequest{System: "sys", User: "hello", MaxTokens: 2000, Deep: true})
  if err != nil {
    t.Fatal(err)
  }
  if out != `{"summary":"ok"}` {
    t.Fatalf("output %q", out)
  }
  if headers.Get("Authorization") != "Bearer ak" || !strings.Contains(headers.Get("Anthropic-Beta"), "server-side-fallback-2026-07-01") {
    t.Fatalf("headers %v", headers)
  }
  if got["model"] != "claude-opus-5-5" || got["max_tokens"] != float64(2000) || got["fallbacks"] != "default" || got["stream"] != true {
    t.Fatalf("body %v", got)
  }
  if _, ok := got["temperature"]; ok {
    t.Fatal("temperature must not be sent to Claude")
  }
  if cfg, _ := got["output_config"].(map[string]any); cfg["effort"] != "high" {
    t.Fatalf("effort %v", got["output_config"])
  }
}

func TestAnthropicProviderReportsRefusal(t *testing.T) {
  server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    sse(w, "message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}`)
    sse(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}`)
    sse(w, "message_stop", `{"type":"message_stop"}`)
  }))
  defer server.Close()
  p := planningProvider{Kind: providerAnthropic, URL: server.URL, Model: "m", Key: "k", Client: server.Client()}
  if _, err := p.complete(context.Background(), completionRequest{System: "s", User: "u"}); err == nil || !strings.Contains(err.Error(), "declined") {
    t.Fatalf("expected refusal error, got %v", err)
  }
}

func TestStripCodeFence(t *testing.T) {
  for in, want := range map[string]string{
    "```json\n{\"a\":1}\n```": `{"a":1}`,
    "```\n{\"a\":1}\n```":     `{"a":1}`,
    `{"a":1}`:                 `{"a":1}`,
  } {
    if got := stripCodeFence(in); got != want {
      t.Fatalf("%q -> %q", in, got)
    }
  }
}
