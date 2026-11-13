package main
import "testing"
func TestDatabaseRoleSecretsMustBeURLSafe(t *testing.T){
 for _,password:=range []string{"short","bad/with/slash/and/characters","bad'quote'untrusted",""}{
  if appDBSecretRE.MatchString(password){t.Fatalf("accepted unsafe database secret %q",password)}
 }
 if !appDBSecretRE.MatchString("0123456789abcdef0123456789abcdef"){
  t.Fatal("random hex password was rejected")
 }
}
