#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
base_url=${1:-http://localhost:8080}
curl --fail --silent --show-error "$base_url/api/health/live"
curl --fail --silent --show-error "$base_url/api/health/ready"
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/check-schema.sql
