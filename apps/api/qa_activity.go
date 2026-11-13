package main

import (
 "net/http"
 "time"
)

// QAActivityEvent contains identifiers and server-generated event types only.
// It never returns test inputs, request prompts, secrets, or screenshots.
type QAActivityEvent struct {
 ID string `json:"id"`
 ProjectID string `json:"project_id"`
 ActorID string `json:"actor_id"`
 ActorEmail string `json:"actor_email"`
 ObjectID string `json:"object_id"`
 ObjectType string `json:"object_type"`
 Action string `json:"action"`
 ResultStatus string `json:"result_status"`
 CreatedAt time.Time `json:"created_at"`
}

func (s *server) qaActivity(w http.ResponseWriter,r *http.Request){
 projectID,ok:=validProjectID(w,r)
 if !ok{return}
 limit,cursor,paged,err:=parseHistoryPageRequest(r)
 if err!=nil{fail(w,400,err.Error());return}
 if !paged{limit=50}
 rows,err:=s.db.Query(r.Context(),`
  SELECT a.id::text,a.project_id::text,COALESCE(a.actor_id::text,''),
    COALESCE(u.email,''),a.object_id::text,a.object_type,
    a.action,a.result_status,a.created_at
  FROM qa_activity_audit a LEFT JOIN gqa_users u ON u.id=a.actor_id
  WHERE a.project_id=$1::uuid
    AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::uuid))
  ORDER BY a.created_at DESC,a.id DESC LIMIT $4
 `,projectID,historyCursorTime(cursor),historyCursorID(cursor),limit+1)
 if err!=nil{fail(w,500,"Unable to retrieve QA activity audit");return}
 defer rows.Close()
 events:=[]QAActivityEvent{}
 for rows.Next(){
  var event QAActivityEvent
  if err:=rows.Scan(&event.ID,&event.ProjectID,&event.ActorID,&event.ActorEmail,
    &event.ObjectID,&event.ObjectType,&event.Action,&event.ResultStatus,
    &event.CreatedAt);err!=nil{
   fail(w,500,"Unable to read QA activity audit");return
  }
  events=append(events,event)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to read QA activity audit");return}
 nextCursor:=""
 if len(events)>limit{
  events=events[:limit]
  last:=events[len(events)-1]
  nextCursor=historyNextCursor(last.CreatedAt,last.ID)
 }
 writeJSON(w,200,listPage[QAActivityEvent]{Items:events,NextCursor:nextCursor})
}
