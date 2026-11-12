package main

import (
 "errors"
 "net/http"
 "strings"
 "time"

 "github.com/jackc/pgx/v5"
 "golang.org/x/crypto/bcrypt"
)

type ManagedUser struct{
 ID string `json:"id"`
 Email string `json:"email"`
 GlobalRole string `json:"global_role"`
 Active bool `json:"active"`
 CreatedAt time.Time `json:"created_at"`
}
type ProjectMember struct{
 UserID string `json:"user_id"`
 Email string `json:"email"`
 Role string `json:"role"`
 AddedAt time.Time `json:"added_at"`
}

func (s *server) users(w http.ResponseWriter,r *http.Request){
 if r.Method==http.MethodGet{
  rows,err:=s.db.Query(r.Context(),`
    SELECT id::text,email,global_role,active,created_at FROM gqa_users
    ORDER BY created_at DESC LIMIT 100`)
  if err!=nil{fail(w,500,"Unable to list users");return}
  defer rows.Close()
  users:=[]ManagedUser{}
  for rows.Next(){
   var u ManagedUser
   if err:=rows.Scan(&u.ID,&u.Email,&u.GlobalRole,&u.Active,&u.CreatedAt);err!=nil{
    fail(w,500,"Unable to read users");return
   }
   users=append(users,u)
  }
  if rows.Err()!=nil{fail(w,500,"Unable to read users");return}
  writeJSON(w,200,users);return
 }
 var input struct{Email string `json:"email"`; Password string `json:"password"`}
 if !parseJSON(w,r,&input){return}
 input.Email=normalizeEmail(input.Email)
 if !validEmail(input.Email)||len(input.Password)<16||len(input.Password)>72{
  fail(w,400,"Provide a valid account email and password of 16-72 characters");return
 }
 hashed,err:=bcrypt.GenerateFromPassword([]byte(input.Password),bcrypt.DefaultCost)
 if err!=nil{fail(w,400,"Invalid password");return}
 var u ManagedUser
 err=s.db.QueryRow(r.Context(),`
  INSERT INTO gqa_users(email,password_hash,global_role)
  VALUES($1,$2,'member')
  ON CONFLICT DO NOTHING
  RETURNING id::text,email,global_role,active,created_at`,
  input.Email,string(hashed)).
  Scan(&u.ID,&u.Email,&u.GlobalRole,&u.Active,&u.CreatedAt)
 if errors.Is(err,pgx.ErrNoRows){fail(w,409,"Account already exists");return}
 if err!=nil{fail(w,500,"Unable to create account");return}
 writeJSON(w,201,u)
}

func (s *server) projectMembers(w http.ResponseWriter,r *http.Request){
 projectID:=r.PathValue("id")
 if r.Method==http.MethodGet{
  rows,err:=s.db.Query(r.Context(),`
   SELECT u.id::text,u.email,m.role,m.created_at
   FROM project_memberships m JOIN gqa_users u ON u.id=m.user_id
   WHERE m.project_id=$1::uuid AND u.active=true
   ORDER BY m.created_at DESC LIMIT 100`,projectID)
  if err!=nil{fail(w,500,"Unable to list project members");return}
  defer rows.Close()
  members:=[]ProjectMember{}
  for rows.Next(){
   var m ProjectMember
   if err:=rows.Scan(&m.UserID,&m.Email,&m.Role,&m.AddedAt);err!=nil{
    fail(w,500,"Unable to read project membership");return
   }
   members=append(members,m)
  }
  if rows.Err()!=nil{fail(w,500,"Unable to read project members");return}
  writeJSON(w,200,members)
  return
 }
 var input struct{
  Email string `json:"email"`
  Role string `json:"role"`
 }
 if !parseJSON(w,r,&input){return}
 input.Email=normalizeEmail(input.Email)
 if !validEmail(input.Email)||!isOneOf(input.Role,roleOwner,roleQA,roleReviewer,roleViewer){
  fail(w,400,"Provide an existing account email and valid project role");return
 }
 account,_:=currentAccount(r)
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Unable to update membership");return}
 defer tx.Rollback(r.Context())
 var subjectID,existingRole string
 err=tx.QueryRow(r.Context(),"SELECT id::text FROM gqa_users WHERE email=$1 AND active=true",input.Email).Scan(&subjectID)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Account not found. Ask an administrator to create it first.");return}
 if err!=nil{fail(w,500,"Unable to check user");return}
 err=tx.QueryRow(r.Context(),`
   SELECT role FROM project_memberships WHERE project_id=$1::uuid AND user_id=$2::uuid FOR UPDATE`,
   projectID,subjectID).Scan(&existingRole)
 if err!=nil&&!errors.Is(err,pgx.ErrNoRows){fail(w,500,"Unable to read membership");return}
 // Existing owners cannot downgrade themselves. Another owner or admin
 // must explicitly change ownership to avoid self-lockout.
 if account.ID==subjectID&&existingRole==roleOwner&&input.Role!=roleOwner{
  fail(w,409,"An owner cannot downgrade their own project access");return
 }
 _,err=tx.Exec(r.Context(),`
  INSERT INTO project_memberships(project_id,user_id,role,granted_by)
  VALUES($1::uuid,$2::uuid,$3,$4::uuid)
  ON CONFLICT(project_id,user_id)
  DO UPDATE SET role=EXCLUDED.role,granted_by=EXCLUDED.granted_by,created_at=now()`,
  projectID,subjectID,input.Role,account.ID)
 if err!=nil{fail(w,500,"Unable to assign role");return}
 _,err=tx.Exec(r.Context(),`
  INSERT INTO project_access_audit(project_id,actor_id,subject_id,action,old_role,new_role)
  VALUES($1::uuid,$2::uuid,$3::uuid,'upsert',$4,$5)`,
  projectID,account.ID,subjectID,existingRole,input.Role)
 if err!=nil{fail(w,500,"Unable to audit role change");return}
 if err:=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to commit role change");return}
 writeJSON(w,200,map[string]string{"user_id":subjectID,"email":input.Email,"role":input.Role})
}

func (s *server) removeProjectMember(w http.ResponseWriter,r *http.Request){
 projectID:=r.PathValue("id")
 memberID:=r.PathValue("userId")
 if !uuidRE.MatchString(memberID){fail(w,400,"Invalid member ID");return}
 account,_:=currentAccount(r)
 if account.ID==memberID{fail(w,409,"You cannot revoke your own membership");return}
 tx,err:=s.db.Begin(r.Context())
 if err!=nil{fail(w,500,"Unable to remove membership");return}
 defer tx.Rollback(r.Context())
 var role string
 err=tx.QueryRow(r.Context(),`
  SELECT role FROM project_memberships
  WHERE project_id=$1::uuid AND user_id=$2::uuid FOR UPDATE`,
  projectID,memberID).Scan(&role)
 if errors.Is(err,pgx.ErrNoRows){fail(w,404,"Membership not found");return}
 if err!=nil{fail(w,500,"Unable to inspect membership");return}
 _,err=tx.Exec(r.Context(),`
  DELETE FROM project_memberships WHERE project_id=$1::uuid AND user_id=$2::uuid`,
  projectID,memberID)
 if err!=nil{fail(w,500,"Unable to remove member");return}
 _,err=tx.Exec(r.Context(),`
  INSERT INTO project_access_audit(project_id,actor_id,subject_id,action,old_role)
  VALUES($1::uuid,$2::uuid,$3::uuid,'revoke',$4)`,
  projectID,account.ID,memberID,role)
 if err!=nil{fail(w,500,"Unable to audit member removal");return}
 if err=tx.Commit(r.Context());err!=nil{fail(w,500,"Unable to commit member removal");return}
 w.WriteHeader(http.StatusNoContent)
}

func (s *server) accessAudit(w http.ResponseWriter,r *http.Request){
 id:=r.PathValue("id")
 rows,err:=s.db.Query(r.Context(),`
  SELECT a.id::text,a.action,a.old_role,a.new_role,actor.email,subject.email,a.created_at
  FROM project_access_audit a
  JOIN gqa_users actor ON actor.id=a.actor_id
  JOIN gqa_users subject ON subject.id=a.subject_id
  WHERE a.project_id=$1::uuid ORDER BY a.created_at DESC LIMIT 100`,id)
 if err!=nil{fail(w,500,"Unable to list access changes");return}
 defer rows.Close()
 type auditEntry struct{
  ID string `json:"id"`
  Action string `json:"action"`
  OldRole string `json:"old_role"`
  NewRole string `json:"new_role"`
  ActorEmail string `json:"actor_email"`
  SubjectEmail string `json:"subject_email"`
  CreatedAt time.Time `json:"created_at"`
 }
 entries:=[]auditEntry{}
 for rows.Next(){
  var e auditEntry
  if err:=rows.Scan(&e.ID,&e.Action,&e.OldRole,&e.NewRole,
   &e.ActorEmail,&e.SubjectEmail,&e.CreatedAt);err!=nil{
   fail(w,500,"Unable to inspect access audit");return
  }
  entries=append(entries,e)
 }
 if rows.Err()!=nil{fail(w,500,"Unable to retrieve access audit");return}
 writeJSON(w,200,entries)
}

var _=strings.TrimSpace
