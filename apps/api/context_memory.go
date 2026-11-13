package main

import (
 "context"
 "strings"
)

type MemoryReference struct {
 ID string `json:"id"`
 Kind string `json:"kind"`
 Content string `json:"content"`
 Source string `json:"source"`
}

func (s *server) relevantMemories(ctx context.Context,projectID,prompt string)([]MemoryReference,error){
  // Only confirmed, non-superseded memories from this project are consulted.
  // Recent memories fill the context when the full-text query does not match.
  rows,err:=s.db.Query(ctx,`
    SELECT id::text,kind,LEFT(content,500),source
    FROM memories
    WHERE project_id=$1::uuid AND status='confirmed'
    ORDER BY CASE WHEN search_document @@ plainto_tsquery('english',$2)
         THEN 1 ELSE 0 END DESC, created_at DESC
    LIMIT 10`,projectID,prompt)
  if err!=nil{return nil,err}
  defer rows.Close()
  result:=[]MemoryReference{}
  for rows.Next(){
    var item MemoryReference
    if err:=rows.Scan(&item.ID,&item.Kind,&item.Content,&item.Source);err!=nil{return nil,err}
    result=append(result,item)
  }
  return result,rows.Err()
}

func enrichedPlanningContext(stack,prompt string,repo RepoSnapshot,memories []MemoryReference)(string,string){
  parts:=[]string{stack}
  parts=append(parts,repo.Technologies...)
  // Existing tests are evidence of tooling, not permission to execute them.
  tech:=strings.Join(parts," ")
  context:=prompt
  for _,memory:=range memories {
    // Preferences and business rules may influence recommended agents,
    // but can never override the server's environment approval policy.
    if memory.Kind=="requirement"||memory.Kind=="architecture"||memory.Kind=="preference"||memory.Kind=="correction"||memory.Kind=="lesson"{
      context+="\n[confirmed project memory] "+memory.Content
    }
  }
  return tech,context
}
