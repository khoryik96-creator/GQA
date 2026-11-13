package main

import (
 "net/http"
 "time"
)

// Existing authenticated endpoints return legacy arrays unless the caller
// explicitly opts in with limit/cursor. Memory/history use the same bounded,
// stable (timestamp, UUID) keyset format.
type listPage[T any] struct {
 Items []T `json:"items"`
 NextCursor string `json:"next_cursor"`
}
func parseHistoryPageRequest(r *http.Request)(int,memoryCursor,bool,error){
 return parseMemoryPageRequest(r)
}
func historyCursorTime(c memoryCursor)any{return memoryCursorTime(c)}
func historyCursorID(c memoryCursor)any{return memoryCursorIDValue(c)}
func historyNextCursor(t time.Time,id string)string{return encodeMemoryCursor(t,id)}
