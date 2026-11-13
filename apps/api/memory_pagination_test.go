package main

import (
 "net/http/httptest"
 "strings"
 "testing"
 "time"
)

func TestMemoryPaginationIsOptInAndBounded(t *testing.T){
 for _,tc:=range []struct{raw string;enabled bool;limit int;invalid bool}{
  {"",false,0,false},
  {"?limit=25",true,25,false},
  {"?limit=100",true,100,false},
  {"?cursor=",true,25,false},
  {"?limit=0",true,0,true},
  {"?limit=101",true,0,true},
  {"?limit=-1",true,0,true},
  {"?limit=NaN",true,0,true},
  {"?limit=1&limit=5",true,0,true},
  {"?cursor=not-valid-base64",true,0,true},
 }{
  r:=httptest.NewRequest("GET","/api/projects/memories"+tc.raw,nil)
  size,_,enabled,err:=parseMemoryPageRequest(r)
  if enabled!=tc.enabled||size!=tc.limit||(err!=nil)!=tc.invalid{
   t.Errorf("request %q: size=%d enabled=%v err=%v",tc.raw,size,enabled,err)
  }
 }
}
func TestMemoryCursorRoundTripAndValidation(t *testing.T){
 stamp:=time.Date(2026,11,13,7,32,15,123456000,time.UTC)
 id:="a2c1de44-dbbd-43b2-a1c1-676ad004ef72"
 encoded:=encodeMemoryCursor(stamp,id)
 result,err:=decodeMemoryCursor(encoded)
 if err!=nil||result.ID!=id||!result.CreatedAt.Equal(stamp){
  t.Fatalf("cursor roundtrip: %+v %v",result,err)
 }
 if memoryCursorTime(result)==nil||memoryCursorIDValue(result)==nil{
  t.Fatal("real cursor cannot be missing SQL key values")
 }
 if memoryCursorTime(memoryCursor{})!=nil||memoryCursorIDValue(memoryCursor{})!=nil{
  t.Fatal("first-page SQL cursor parameters must be NULL")
 }
 for _,bad:=range []string{
  strings.Repeat("a",maxMemoryCursorBytes+1),
  "!!!!",
  "e30",
  encodeMemoryCursor(time.Now().Add(48*time.Hour),id),
  encodeMemoryCursor(stamp,"invalid-id"),
 }{
  if _,err:=decodeMemoryCursor(bad);err==nil{t.Errorf("accepted malformed cursor %q",bad)}
 }
}
