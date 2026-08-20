#!/bin/sh
# Container entrypoint: migrate -> seed (idempotent) -> serve.
set -e

echo "[start] waiting for the database..."
tries=0
until npx prisma migrate deploy > /tmp/migrate.log 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "[start] database never became reachable; last attempt said:"
    cat /tmp/migrate.log
    exit 1
  fi
  sleep 2
done
cat /tmp/migrate.log

echo "[start] seeding demo data (skips anything that already exists)..."
npx prisma db seed

echo "[start] serving on port 3000"
exec npm start
