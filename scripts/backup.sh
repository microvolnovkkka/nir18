#!/bin/sh
# Make a consistent PostgreSQL + media_data snapshot with a short API outage.
set -eu
if [ "$#" -gt 1 ] || [ "${1:-}" = "--help" ]; then
    echo 'Usage: sh scripts/backup.sh [output-directory]'
    if [ "${1:-}" = "--help" ]; then exit 0; fi
    exit 2
fi
. "$(dirname -- "$0")/backup-common.sh"

destination=${1:-backups}
mkdir -p -- "$destination"
destination=$(CDPATH= cd -- "$destination" && pwd)
stage=$(mktemp -d "$destination/.nir18-backup-XXXXXXXX")
lock_database
running=$(dc ps --services --status running)
if printf '%s\n' "$running" | grep -qx api; then
    resume_api=true
    dc stop -t 120 api >&2
fi

created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sql -c "COPY (SELECT encode(sha256,'hex') || '  ' || storage_key FROM media WHERE state='ready' ORDER BY storage_key) TO STDOUT" > "$stage/ready-files.sha256"
if [ -s "$stage/ready-files.sha256" ]; then
    media 'cd /var/lib/nir/media; sha256sum --strict -c -' < "$stage/ready-files.sha256" >&2
fi
dc exec -T db sh -c 'exec pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$stage/database.dump"
media "$inventory" > "$stage/media-files.sha256"
media 'exec tar -C /var/lib/nir/media -cf - .' > "$stage/media.tar"
major=$(pg_major)
schema=$(schema_version)
code=unknown
if command -v git >/dev/null 2>&1; then code=$(git rev-parse HEAD 2>/dev/null || echo unknown); fi
{
    printf 'format=1\ncreated_utc=%s\ncode_commit=%s\n' "$created" "$code"
    printf 'postgres_major=%s\nschema_version=%s\n' "$major" "$schema"
    printf 'media_files=%s\n' "$(wc -l < "$stage/media-files.sha256" | tr -d ' ')"
} > "$stage/metadata.txt"
(cd "$stage" && sha256sum --binary database.dump media.tar media-files.sha256 metadata.txt ready-files.sha256 > SHA256SUMS)
name="nir18-$(date -u +%Y%m%dT%H%M%SZ)-${stage##*-}.tar.gz"
tar -czf "$stage/snapshot.tar.gz" -C "$stage" SHA256SUMS database.dump media.tar media-files.sha256 metadata.txt ready-files.sha256
mv -- "$stage/snapshot.tar.gz" "$destination/$name"
printf '%s\n' "$destination/$name"
