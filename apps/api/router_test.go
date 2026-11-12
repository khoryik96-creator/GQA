package main

import "testing"

func containsAgent(decision RoutingDecision, wanted string) bool {
  for _, a := range decision.Agents {
    if a.ID == wanted {
      return true
    }
  }
  return false
}

func TestFullstackDefaultAgents(t *testing.T) {
  d := selectAgents("fullstack", "Next.js, PostgreSQL", "Check signup", "staging")
  for _, a := range []string{"repo-intelligence", "web", "api", "backend"} {
    if !containsAgent(d, a) {
      t.Fatalf("expected %s, got %#v", a, d.Agents)
    }
  }
  if d.ApprovalRequired || d.ExecutionMode != "plan_only" {
    t.Fatalf("unexpected unsafe default: %#v", d)
  }
}

func TestMobileAndPerformanceApproval(t *testing.T) {
  d := selectAgents("mobile", "Kotlin", "Test Android API and load performance", "staging")
  if !containsAgent(d, "mobile") || !containsAgent(d, "performance") || !d.ApprovalRequired {
    t.Fatalf("expected mobile + performance with approval: %#v", d)
  }
}

func TestProductionAlwaysRequiresApproval(t *testing.T) {
  d := selectAgents("api", "Go", "Check API contract", "production")
  if !d.ApprovalRequired {
    t.Fatal("production must require approval")
  }
}

func TestNoAccidentalMobileAgent(t *testing.T) {
  d := selectAgents("web", "React", "Check forms", "local")
  if containsAgent(d, "mobile") {
    t.Fatal("mobile should not be selected for a web-only request")
  }
}
