package main

import "testing"

func TestTargetMustMatchAllowlist(t *testing.T){
 allow:="http://fixture:8081,https://staging.example.com"
 cases:=[]struct{target string;ok bool}{
  {"http://fixture:8081",true},
  {"http://fixture:8081/",true},
  {"https://staging.example.com",true},
  {"https://staging.example.com:443",false},
  {"http://fixture:8081@evil.example",false},
  {"http://fixture:8081/other",false},
  {"http://fixture:8081?jump=1",false},
  {"http://evil.example",false},
  {"file:///etc/passwd",false},
  {"http://fixture:8081.evil.example",false},
 }
 for _,tc:=range cases{if got:=allowedSmokeTarget(tc.target,allow);got!=tc.ok{
  t.Errorf("allowedSmokeTarget(%q)=%v, want %v",tc.target,got,tc.ok)
 }}
}
