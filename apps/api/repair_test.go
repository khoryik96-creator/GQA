package main

import (
 "testing"
 "reflect"
)

func TestRepairOnlyReplacesActionName(t *testing.T){
 original:=[]BrowserAction{
  {Op:"navigate",Path:"/"},
  {Op:"click_role",Role:"button",Name:"Show details"},
  {Op:"assert_text",Text:"Fixture details visible"},
 }
 checks:=[]SmokeCheck{
  {Name:"Navigate",Status:"passed"},
  {Name:"Click accessible element",Status:"failed",Repair:&RepairHint{
   StepIndex:1,Op:"click_role",Role:"button",
   OriginalName:"Show details",ProposedName:"Reveal details",
   Confidence:0.52,Basis:"visible_accessible_name"}},
 }
 repaired,hint,err:=repairFromEvidence(original,checks)
 if err!=nil{t.Fatal(err)}
 if hint.ProposedName!="Reveal details"||repaired[1].Name!="Reveal details"{
  t.Fatalf("incorrect repair %#v",repaired)
 }
 if !reflect.DeepEqual(original[2],repaired[2])||original[1].Name!="Show details"{
  t.Fatal("Original business assertion or source flow was modified")
 }
 if browserFlowDigest(original)==browserFlowDigest(repaired){t.Fatal("Repaired digest must change")}
 if !preservesAssertions(original,repaired,1){t.Fatal("Expected safe repair lineage")}
}

func TestRejectUnverifiedOrTamperedSuggestions(t *testing.T){
 original:=[]BrowserAction{
  {Op:"navigate",Path:"/"},
  {Op:"click_role",Role:"button",Name:"Show details"},
  {Op:"assert_text",Text:"Fixture details visible"},
 }
 base:=RepairHint{
  StepIndex:1,Op:"click_role",Role:"button",
  OriginalName:"Show details",ProposedName:"Reveal details",
  Confidence:0.51,Basis:"visible_accessible_name",
 }
 for _,tc:=range []RepairHint{
  {StepIndex:0,Op:base.Op,Role:base.Role,OriginalName:base.OriginalName,ProposedName:base.ProposedName,Confidence:0.51,Basis:base.Basis},
  {StepIndex:1,Op:"assert_text",Role:base.Role,OriginalName:base.OriginalName,ProposedName:base.ProposedName,Confidence:0.51,Basis:base.Basis},
  {StepIndex:1,Op:base.Op,Role:base.Role,OriginalName:"Wrong",ProposedName:base.ProposedName,Confidence:0.51,Basis:base.Basis},
  {StepIndex:1,Op:base.Op,Role:base.Role,OriginalName:base.OriginalName,ProposedName:"API token",Confidence:0.51,Basis:base.Basis},
  {StepIndex:1,Op:base.Op,Role:base.Role,OriginalName:base.OriginalName,ProposedName:base.ProposedName,Confidence:0.1,Basis:base.Basis},
 }{
  checks:=[]SmokeCheck{{Status:"passed"},{Status:"failed",Repair:&tc}}
  if _,_,err:=repairFromEvidence(original,checks);err==nil{t.Errorf("Accepted untrusted repair: %#v",tc)}
 }
 if _,_,err:=repairFromEvidence(original,[]SmokeCheck{{Status:"passed"},{Status:"passed",Repair:&base}});err==nil{
  t.Fatal("A passing test must never suggest self-healing")
 }
 revised:=append([]BrowserAction(nil),original...)
 revised[2].Text="Anything passes"
 if preservesAssertions(original,revised,1){t.Fatal("Assertions must not be relaxed")}
}

func TestRevisionKeyPolicy(t *testing.T){
 for _,value:=range []string{"fixture-renamed-v1","a.2.3","123"}{
  if !appRevisionRE.MatchString(value){t.Errorf("valid app revision rejected: %q",value)}
 }
 for _,value:=range []string{"","a","with space","a;DROP TABLE memories","../../secret"}{
  if appRevisionRE.MatchString(value){t.Errorf("invalid app revision accepted: %q",value)}
 }
}
