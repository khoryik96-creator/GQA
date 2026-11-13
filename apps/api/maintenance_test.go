package main
import ("testing")
func TestEvidenceRetentionIsExplicitOptIn(t *testing.T){
 t.Setenv("GQA_EVIDENCE_RETENTION_DAYS","")
 if days,err:=evidenceRetentionDays();err!=nil||days!=0{t.Fatalf("default retention: %d %v",days,err)}
 for _,bad:=range []string{"-1","invalid","4000"}{
  t.Setenv("GQA_EVIDENCE_RETENTION_DAYS",bad)
  if _,err:=evidenceRetentionDays();err==nil{t.Errorf("invalid retention %s accepted",bad)}
 }
 t.Setenv("GQA_EVIDENCE_RETENTION_DAYS","30")
 if days,err:=evidenceRetentionDays();err!=nil||days!=30{t.Fatalf("opt-in retention %d %v",days,err)}
}
