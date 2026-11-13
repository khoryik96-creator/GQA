#!/bin/sh
set -eu

if [ -z "${GQA_DB_APP_PASSWORD:-}" ]; then
 echo "Set GQA_DB_APP_PASSWORD" >&2
 exit 1
fi
case "$GQA_DB_APP_PASSWORD" in
 *[!a-zA-Z0-9_-]*) echo "App DB password must be URL-safe" >&2; exit 1 ;;
esac
if [ "$(printf %s "$GQA_DB_APP_PASSWORD" | wc -c)" -lt 32 ]; then
 echo "App DB password must have at least 32 bytes" >&2
 exit 1
fi

# The migrator is the only component with schema DDL privileges.
# Keep the schema ledger separate from application tables.
psql -X -h db -U gqa -d gqa -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS public.gqa_schema_migrations (
 version INTEGER PRIMARY KEY CHECK (version > 0),
 checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
 applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);"

expected=1
last=0
found=false
for file in /migrations/versions/[0-9][0-9][0-9][0-9]_*.sql; do
 [ -f "$file" ] || continue
 found=true
 name=${file##*/}
 padded=${name%%_*}
 version=$(printf '%s' "$padded" | sed 's/^0*//')
 [ -n "$version" ] || { echo "Migration version must be positive: $name" >&2; exit 1; }
 [ "$version" -eq "$expected" ] || {
   echo "Migration order is not contiguous at $name (expected $expected)" >&2
   exit 1
 }
 checksum=$(sha256sum "$file" | cut -d ' ' -f 1)
 recorded=$(psql -X -h db -U gqa -d gqa -At -v ON_ERROR_STOP=1 -c   "SELECT checksum FROM public.gqa_schema_migrations WHERE version=$version")
 if [ -n "$recorded" ]; then
   [ "$recorded" = "$checksum" ] || {
     echo "Refusing edited migration $name: stored checksum differs" >&2
     exit 1
   }
   echo "Verified migration $name"
 else
   # One transaction per migration: schema DDL and ledger entry commit together.
   # A failed migration rolls back both, without marking it as applied.
   psql -X -h db -U gqa -d gqa -v ON_ERROR_STOP=1 --single-transaction      -f "$file"      -c "INSERT INTO public.gqa_schema_migrations (version,checksum) VALUES ($version,'$checksum')"
   echo "Applied migration $name"
 fi
 last=$version
 expected=$((expected+1))
done
[ "$found" = true ] || { echo "No numbered SQL migrations found" >&2; exit 1; }
# A checkout older than the database is not allowed to silently downgrade it.
newer=$(psql -X -h db -U gqa -d gqa -At -v ON_ERROR_STOP=1 -c  "SELECT count(*) FROM public.gqa_schema_migrations WHERE version > $last")
[ "$newer" = 0 ] || { echo "Database schema is newer than this code; refusing startup" >&2; exit 1; }

# Role grants are idempotent; only the one-shot migrator has bootstrap rights.
psql -X -h db -U gqa -d gqa -v ON_ERROR_STOP=1 --single-transaction  -v app_password="$GQA_DB_APP_PASSWORD" -f /migrations/roles.sql
echo "GQA schema version $last and least-privileged application role ready"
