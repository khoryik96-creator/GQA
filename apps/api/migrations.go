package main

import (
 "context"
 "errors"
 "os"
 "regexp"
 "github.com/jackc/pgx/v5"
 "github.com/jackc/pgx/v5/pgxpool"
)

// Schema upgrades occur ONLY in the short-lived migration service, using
// the local database administrator. The API connects as gqa_app and
// cannot create tables, roles, schemas or extensions.
var appDBSecretRE=regexp.MustCompile(`^[A-Za-z0-9_-]{24,128}$`)

func applySchemaAndGrants(ctx context.Context,db *pgxpool.Pool)error{
 pwd:=os.Getenv("GQA_DB_APP_PASSWORD")
 if !appDBSecretRE.MatchString(pwd){
  return errors.New("GQA_DB_APP_PASSWORD requires 24-128 URL-safe characters")
 }
 if _,err:=db.Exec(ctx,schema,pgx.QueryExecModeSimpleProtocol);err!=nil{return err}
 _,err:=db.Exec(ctx,`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gqa_app') THEN
   CREATE ROLE gqa_app LOGIN;
  END IF;
 END $$;`)
 if err!=nil{return err}
 // PostgreSQL performs SQL-literal escaping; never concatenate untrusted
 // password text directly into an ALTER ROLE command.
 var alter string
 err=db.QueryRow(ctx,`SELECT format('ALTER ROLE gqa_app PASSWORD %L',$1)`,pwd).Scan(&alter)
 if err!=nil{return err}
 if _,err=db.Exec(ctx,alter);err!=nil{return err}
 _,err=db.Exec(ctx,`
  GRANT CONNECT ON DATABASE gqa TO gqa_app;
  GRANT USAGE ON SCHEMA public TO gqa_app;
  GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO gqa_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE gqa IN SCHEMA public
   GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO gqa_app;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
 `,pgx.QueryExecModeSimpleProtocol)
 return err
}
