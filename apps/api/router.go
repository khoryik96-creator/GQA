package main

import "strings"

type AgentSelection struct {
  ID     string `json:"id"`
  Name   string `json:"name"`
  Reason string `json:"reason"`
}

type RoutingDecision struct {
  Agents           []AgentSelection `json:"selected_agents"`
  Warnings         []string         `json:"warnings"`
  ApprovalRequired bool             `json:"approval_required"`
  ExecutionMode    string           `json:"execution_mode"`
}

func selectAgents(appType, stack, prompt, environment string) RoutingDecision {
  haystack := strings.ToLower(strings.Join([]string{stack, prompt}, " "))
  has := func(keywords ...string) bool {
    for _, keyword := range keywords {
      if strings.Contains(haystack, keyword) {
        return true
      }
    }
    return false
  }

  decision := RoutingDecision{
    Agents: []AgentSelection{{
      ID: "repo-intelligence", Name: "Repository Intelligence",
      Reason: "Every request needs project context and risk analysis.",
    }},
    ExecutionMode: "plan_only",
    Warnings: []string{"Planning only: no test has been executed and no AI model has been called."},
  }
  add := func(id, name, reason string) {
    decision.Agents = append(decision.Agents, AgentSelection{ID: id, Name: name, Reason: reason})
  }

  if appType == "web" || appType == "fullstack" || has("web", "frontend", "browser", "playwright", "ui", "website", "user journey", "end-to-end") {
    add("web", "Web QA", "Browser or user journey coverage is relevant.")
  }
  if appType == "mobile" || has("android", "ios", "mobile", "appium", "maestro", "device") {
    add("mobile", "Mobile QA", "Mobile app/device behavior is relevant.")
  }
  if appType == "api" || appType == "backend" || appType == "fullstack" || appType == "mobile" || has("api", "endpoint", "graphql", "grpc", "contract") {
    add("api", "API QA", "Service interfaces or application APIs are in scope.")
  }
  if appType == "backend" || appType == "fullstack" || has("database", "backend", "transaction", "queue", "redis", "integration", "data integrity") {
    add("backend", "Backend QA", "Business logic, persistence or service integrations are relevant.")
  }
  if has("performance", "load test", "stress", "throughput", "latency", "concurrent", "soak", "benchmark", "500 users") {
    add("performance", "Performance QA", "Load or response-time behavior was requested.")
    decision.ApprovalRequired = true
    decision.Warnings = append(decision.Warnings, "Performance tests require target-specific authorization and resource limits.")
  }
  if has("security", "vulnerab", "penetration", "owasp", "permission", "authorization", "authentication", "injection") {
    add("security", "Security QA", "Security controls or vulnerabilities are in scope.")
    if has("scan", "penetration", "exploit", "fuzz") {
      decision.ApprovalRequired = true
      decision.Warnings = append(decision.Warnings, "Active security checks require explicit target authorization.")
    }
  }
  if has("bug", "failure", "failed", "flaky", "regression", "root cause", "defect", "error") {
    add("defect", "Defect Investigator", "Failure investigation or regression analysis was requested.")
  }
  if environment == "production" {
    decision.ApprovalRequired = true
    decision.Warnings = append(decision.Warnings, "Production execution is disabled until separately authorized.")
  }
  return decision
}
