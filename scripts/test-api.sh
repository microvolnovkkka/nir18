#!/bin/sh
# Dedicated disposable PostgreSQL; never uses .env or the site's volumes.
set -eu
cd "$(dirname "$0")/.."
test_name="nir18-api-test-$$"
cleanup() { docker rm -f "$test_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker run --rm -d --name "$test_name" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=local-test-only postgres:18-bookworm >/dev/null
attempt=0
until docker exec "$test_name" pg_isready -U postgres >/dev/null 2>&1; do
  attempt=$((attempt+1))
  if [ "$attempt" -ge 30 ]; then echo 'Test PostgreSQL did not start' >&2; exit 1; fi
  sleep 1
done
test_port=$(docker port "$test_name" 5432/tcp | sed 's/.*://')
cd backend
TEST_DATABASE_URL="postgres://postgres:local-test-only@127.0.0.1:$test_port/postgres?sslmode=disable" go test -race -count=1 ./...
go vet ./...
