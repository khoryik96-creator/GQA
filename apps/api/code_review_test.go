package main

import (
  "context"
  "encoding/json"
  "fmt"
  "net/http"
  "net/http/httptest"
  "strings"
  "sync/atomic"
  "testing"
)

func TestSelectReviewFilesPrioritisesRiskAndExcludesNoise(t *testing.T) {
  entries := []treeEntry{
    {"README.md", 100},
    {"node_modules/lib/index.js", 100},
    {"web/dist/app.min.js", 100},
    {"api/auth/session.go", 900},
    {"api/auth/session_test.go", 900},
    {"api/util/strings.go", 300},
    {"api/payments/charge.ts", 500},
    {"assets/logo.png", 100},
    {"api/huge.go", reviewMaxFileBytes + 1},
    {"proto/service.pb.go", 100},
  }
  got, skipped := selectReviewFiles(entries, "payments")
  paths := []string{}
  for _, e := range got {
    paths = append(paths, e.Path)
  }
  want := "api/auth/session.go,api/payments/charge.ts,api/util/strings.go"
  if strings.Join(paths, ",") != want {
    t.Fatalf("selected %v", paths)
  }
  if skipped != 0 {
    t.Fatalf("skipped %d", skipped)
  }
  if reviewPriority("api/payments/charge.ts", "payments") <= reviewPriority("api/util/strings.go", "payments") {
    t.Fatal("focus keywords should raise priority")
  }
}

func TestSelectReviewFilesRespectsByteBudget(t *testing.T) {
  entries := []treeEntry{}
  for i := 0; i < 20; i++ {
    entries = append(entries, treeEntry{fmt.Sprintf("src/file%02d.go", i), 50 << 10})
  }
  got, skipped := selectReviewFiles(entries, "")
  total := 0
  for _, e := range got {
    total += e.Size
  }
  if total > reviewMaxTotalBytes || len(got)+skipped != 20 || skipped == 0 {
    t.Fatalf("budget not applied: %d files, %d bytes, %d skipped", len(got), total, skipped)
  }
}

func TestBatchSourcesSplitsLargeSets(t *testing.T) {
  files := []sourceFile{}
  for i := 0; i < 5; i++ {
    files = append(files, sourceFile{Path: fmt.Sprint(i), Content: strings.Repeat("x", 50<<10)})
  }
  batches := batchSources(files)
  if len(batches) != 3 {
    t.Fatalf("got %d batches", len(batches))
  }
  for _, b := range batches {
    size := 0
    for _, f := range b {
      size += len(f.Content)
    }
    if size > reviewMaxBatchBytes {
      t.Fatalf("batch too large: %d", size)
    }
  }
}

var reviewSource = sourceFile{Path: "api/orders.go", Content: strings.Join([]string{
  "package api",
  "",
  "func refund(o *Order, amount int) error {",
  "  if amount > 0 {",
  "    o.Balance -= amount",
  "  }",
  "  return db.Save(o)",
  "}",
}, "\n")}

func TestValidateFindingsKeepsOnlyVerifiableEvidence(t *testing.T) {
  files := map[string]sourceFile{reviewSource.Path: reviewSource}
  candidates := []ReviewFinding{
    {File: "api/orders.go", LineStart: 4, LineEnd: 5, Severity: "High", Category: "data-integrity", Confidence: "high",
      Title: "Refund can exceed the order balance", Evidence: "o.Balance   -= amount"},
    // Off by two lines: still accepted inside the tolerance window.
    {File: "./api/orders.go", LineStart: 5, LineEnd: 5, Severity: "medium", Category: "unknown-category", Confidence: "medium",
      Title: "Save error context", Evidence: "return db.Save(o)"},
    {File: "api/missing.go", LineStart: 1, Severity: "high", Confidence: "high", Title: "Hallucinated file", Evidence: "package api"},
    {File: "api/orders.go", LineStart: 3, Severity: "high", Confidence: "high", Title: "Invented code", Evidence: "o.Delete()"},
    {File: "api/orders.go", LineStart: 99, Severity: "high", Confidence: "high", Title: "Bad line", Evidence: "package api"},
    {File: "api/orders.go", LineStart: 4, Severity: "catastrophic", Confidence: "high", Title: "Bad severity", Evidence: "if amount > 0"},
  }
  kept, discarded := validateFindings(candidates, files)
  if len(kept) != 2 || discarded != 4 {
    t.Fatalf("kept %d discarded %d: %+v", len(kept), discarded, kept)
  }
  if kept[0].Severity != "high" || kept[0].Status != "suspected" || kept[1].Category != "correctness" || kept[1].File != "api/orders.go" {
    t.Fatalf("normalisation failed: %+v", kept)
  }
}

func TestFinalizeFindingsDedupesSortsAndCounts(t *testing.T) {
  in := []ReviewFinding{
    {File: "b.go", LineStart: 3, Severity: "low", Title: "x"},
    {File: "a.go", LineStart: 9, Severity: "critical", Title: "Y"},
    {File: "a.go", LineStart: 9, Severity: "critical", Title: "y"},
  }
  out, counts := finalizeFindings(in)
  if len(out) != 2 || out[0].Severity != "critical" || out[0].ID != "CR-001" || counts["critical"] != 1 || counts["low"] != 1 || counts["high"] != 0 {
    t.Fatalf("got %+v %v", out, counts)
  }
}

func TestBuildReviewPromptNumbersLinesAndMarksFocusUntrusted(t *testing.T) {
  prompt := buildReviewPrompt("o/r", strings.Repeat("a", 40), "check refunds", []sourceFile{reviewSource}, 0, 1)
  for _, want := range []string{"5:     o.Balance -= amount", "===== FILE: api/orders.go =====", "untrusted", "Batch 1 of 1"} {
    if !strings.Contains(prompt, want) {
      t.Fatalf("prompt missing %q", want)
    }
  }
}

func TestRunCodeReviewAgainstMockProvider(t *testing.T) {
  var calls int32
  server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    atomic.AddInt32(&calls, 1)
    var body struct {
      Messages []chatMessage `json:"messages"`
    }
    _ = json.NewDecoder(r.Body).Decode(&body)
    if len(body.Messages) != 2 || !strings.Contains(body.Messages[0].Content, "UNTRUSTED DATA") {
      t.Errorf("unexpected messages: %+v", body.Messages)
    }
    review := map[string]any{
      "summary": "One real defect.",
      "findings": []map[string]any{
        {"file": "api/orders.go", "line_start": 4, "line_end": 5, "severity": "high", "category": "validation",
          "title": "Refund amount is not bounded by balance", "description": "Negative balances are possible.",
          "evidence": "o.Balance -= amount", "recommendation": "Reject refunds larger than the balance.",
          "suggested_test": "Refund 200 on an order with balance 100 and expect an error.", "confidence": "high"},
        {"file": "api/orders.go", "line_start": 2, "severity": "low", "category": "correctness",
          "title": "Fabricated", "evidence": "panic(\"boom\")", "confidence": "low"},
      },
      "coverage_gaps": []map[string]any{{"area": "Refunds", "reason": "No tests", "suggested_tests": []string{"over-refund"}}},
    }
    content, _ := json.Marshal(review)
    reply, _ := json.Marshal(map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": "```json\n" + string(content) + "\n```"}, "finish_reason": "stop"}}})
    w.Write(reply)
  }))
  defer server.Close()
  provider := planningProvider{Kind: providerDeepSeek, URL: server.URL, Model: "deepseek-v4-flash", Key: "k", Client: server.Client()}
  result, discarded, notices := runCodeReview(context.Background(), provider, "o/r", strings.Repeat("a", 40), "", []sourceFile{reviewSource})
  if len(notices) != 0 || calls != 1 {
    t.Fatalf("notices %v calls %d", notices, calls)
  }
  if len(result.Findings) != 1 || discarded != 1 || result.Findings[0].Category != "validation" {
    t.Fatalf("findings %+v discarded %d", result.Findings, discarded)
  }
  if len(result.CoverageGaps) != 1 || result.Summary != "One real defect." {
    t.Fatalf("gaps/summary %+v %q", result.CoverageGaps, result.Summary)
  }
}

func TestRunCodeReviewReportsProviderFailurePerBatch(t *testing.T) {
  server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
  defer server.Close()
  provider := planningProvider{Kind: providerDeepSeek, URL: server.URL, Model: "m", Key: "bad", Client: server.Client()}
  result, _, notices := runCodeReview(context.Background(), provider, "o/r", "sha", "", []sourceFile{reviewSource})
  if len(result.Findings) != 0 || len(notices) != 1 || !strings.Contains(notices[0], "HTTP 401") {
    t.Fatalf("expected one failure notice, got %v", notices)
  }
}

func TestSanitizeGapsDedupesAcrossBatches(t *testing.T) {
  gaps := sanitizeGaps([]CoverageGap{{Area: "Auth", Reason: "No tests"}, {Area: "auth ", Reason: "No  tests"}, {Area: "", Reason: "x"}, {Area: "Billing", Reason: "No tests"}})
  if len(gaps) != 2 {
    t.Fatalf("got %+v", gaps)
  }
}
