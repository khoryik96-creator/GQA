package main

import (
 "encoding/base64"
 "encoding/json"
 "errors"
 "net/http"
 "regexp"
 "strconv"
 "strings"
 "time"
)

const (
 defaultMemoryPageSize=25
 maxMemoryPageSize=100
 maxMemoryCursorBytes=512
)
type memoryCursor struct {
 CreatedAt time.Time `json:"t"`
 ID string `json:"i"`
}
type memoryPage struct {
 Items []Memory `json:"items"`
 NextCursor string `json:"next_cursor"`
}
var memoryCursorID=regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func encodeMemoryCursor(created time.Time,id string)string{
 raw,_:=json.Marshal(memoryCursor{CreatedAt:created.UTC(),ID:strings.ToLower(id)})
 return base64.RawURLEncoding.EncodeToString(raw)
}
func decodeMemoryCursor(raw string)(memoryCursor,error){
 if raw==""{return memoryCursor{},nil}
 if len(raw)>maxMemoryCursorBytes{return memoryCursor{},errors.New("invalid memory cursor")}
 decoded,err:=base64.RawURLEncoding.DecodeString(raw)
 if err!=nil||len(decoded)>maxMemoryCursorBytes{return memoryCursor{},errors.New("invalid memory cursor")}
 var cursor memoryCursor
 if err=json.Unmarshal(decoded,&cursor);err!=nil||cursor.CreatedAt.IsZero()||
  !memoryCursorID.MatchString(cursor.ID)||cursor.CreatedAt.After(time.Now().Add(24*time.Hour)){
  return memoryCursor{},errors.New("invalid memory cursor")
 }
 return cursor,nil
}
// Pagination is opt-in. Legacy clients still receive their existing flat array.
func parseMemoryPageRequest(r *http.Request)(int,memoryCursor,bool,error){
 values:=r.URL.Query()
 rawLimit,hasLimit:=values["limit"]
 rawCursor,hasCursor:=values["cursor"]
 if !hasLimit&&!hasCursor{return 0,memoryCursor{},false,nil}
 if len(rawLimit)>1||len(rawCursor)>1{return 0,memoryCursor{},true,errors.New("invalid memory pagination")}
 limit:=defaultMemoryPageSize
 if hasLimit{
  if len(rawLimit)!=1||rawLimit[0]==""{return 0,memoryCursor{},true,errors.New("invalid memory page limit")}
  parsed,err:=strconv.Atoi(rawLimit[0])
  if err!=nil||parsed<1||parsed>maxMemoryPageSize{return 0,memoryCursor{},true,errors.New("invalid memory page limit")}
  limit=parsed
 }
 cursorRaw:=""
 if hasCursor{cursorRaw=rawCursor[0]}
 cursor,err:=decodeMemoryCursor(cursorRaw)
 if err!=nil{return 0,memoryCursor{},true,err}
 return limit,cursor,true,nil
}

func memoryCursorTime(cursor memoryCursor)any{
 if cursor.ID==""{return nil}
 return cursor.CreatedAt
}
func memoryCursorIDValue(cursor memoryCursor)any{
 if cursor.ID==""{return nil}
 return cursor.ID
}
