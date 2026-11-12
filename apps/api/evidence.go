package main

import (
 "strings"
)

type RunEvidence struct {
 JobID string `json:"job_id,omitempty"`
 WorkerLifecycle string `json:"worker_lifecycle"`
 FailureKind string `json:"failure_kind"`
 FailedStepIndex *int `json:"failed_step_index,omitempty"`
 LastPath string `json:"last_path,omitempty"`
 ConsoleErrors int `json:"console_errors"`
 PageExceptions int `json:"page_exceptions"`
 FailedRequests int `json:"failed_requests"`
 HTTP5xx int `json:"http_5xx"`
}

// The runner is an execution service, not a trusted source of authorization.
// Store only schema-bounded diagnostics. Never persist raw page content, cookie
// values, network query strings, headers or console messages as run evidence.
func cleanRunEvidence(raw RunEvidence, status string) RunEvidence {
  allowedFailure:=[]string{
    "none","assertion_mismatch","locator_rename_candidate",
    "element_unavailable","navigation_failed","browser_step_failed",
    "browser_initialization_failed","browser_smoke_failure","api_health_failure",
    "worker_timeout","worker_crash","worker_error","worker_spawn_failure",
    "worker_ipc_failure","invalid_worker_result","invalid_worker_timeout",
    "runner_unavailable",
  }
  if !isOneOf(raw.FailureKind,allowedFailure...){raw.FailureKind="unknown"}
  if !uuidRE.MatchString(raw.JobID){raw.JobID=""}
  if raw.WorkerLifecycle!="single_job_process" && raw.WorkerLifecycle!="ephemeral_container" {
    raw.WorkerLifecycle="unverified"
  }
  if raw.FailedStepIndex!=nil && (*raw.FailedStepIndex<0||*raw.FailedStepIndex>7){
    raw.FailedStepIndex=nil
  }
  if len(raw.LastPath)>160||!strings.HasPrefix(raw.LastPath,"/")||
    strings.HasPrefix(raw.LastPath,"//")||strings.ContainsAny(raw.LastPath,"?#\r\n") {
    raw.LastPath=""
  }
  for _,value:=range []*int{&raw.ConsoleErrors,&raw.PageExceptions,&raw.FailedRequests,&raw.HTTP5xx}{
    if *value<0{*value=0}
    if *value>999{*value=999}
  }
  if status=="passed" {
    raw.FailureKind="none"
    raw.FailedStepIndex=nil
  } else if raw.FailureKind=="none"||raw.FailureKind==""{
    raw.FailureKind="unknown"
  }
  return raw
}
