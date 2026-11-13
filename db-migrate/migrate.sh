#!/bin/sh
set -eu
if [ -z "$GQA_DB_APP_PASSWORD" ]; then
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
# Bootstrap superuser is used only by this short-lived migration task.
psql -h db -U gqa -d gqa -v ON_ERROR_STOP=1 -f /migrations/schema.sql
psql -h db -U gqa -d gqa -v ON_ERROR_STOP=1 \
  -v app_password="$GQA_DB_APP_PASSWORD" -f /migrations/roles.sql
echo "GQA database schema and least-privileged application role ready"
