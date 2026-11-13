package main

import "testing"

func TestProjectPermissionMatrix(t *testing.T){
 matrix:=[]struct{
  role string
  read,qa,review,manage bool
 }{
  {roleOwner,true,true,true,true},
  {roleQA,true,true,false,false},
  {roleReviewer,true,false,true,false},
  {roleViewer,true,false,false,false},
  {"",false,false,false,false},
  {"unknown",false,false,false,false},
 }
 for _,row:=range matrix{
  if got:=canAccess(row.role,"read");got!=row.read{t.Errorf("%s read=%v",row.role,got)}
  if got:=canAccess(row.role,"qa");got!=row.qa{t.Errorf("%s qa=%v",row.role,got)}
  if got:=canAccess(row.role,"review");got!=row.review{t.Errorf("%s review=%v",row.role,got)}
  if got:=canAccess(row.role,"manage");got!=row.manage{t.Errorf("%s manage=%v",row.role,got)}
  if canAccess(row.role,"unlisted"){t.Errorf("%s should not have unknown privilege",row.role)}
 }
}
func TestEmailNormalizationAndValidation(t *testing.T){
 good:=normalizeEmail("  QA.Example+1@Example.COM  ")
 if good!="qa.example+1@example.com"||!validEmail(good){t.Fatal("valid identity normalized incorrectly")}
 for _,s:=range []string{"","@example.com","user@","foo bar@example.com","x@example.com.evil\x00"}{
  if validEmail(s){t.Fatalf("accepted invalid email %q",s)}
 }
}
