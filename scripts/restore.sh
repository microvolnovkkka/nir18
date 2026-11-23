#!/bin/sh
# Restore to an empty, isolated Compose project. API stays stopped until verified.
set -eu
if [ "$#" -ne 1 ] || [ "${1:-}" = "--help" ]; then
    echo 'Usage: sh scripts/restore.sh /absolute/path/to/backup.tar.gz'
    if [ "${1:-}" = "--help" ]; then exit 0; fi
    exit 2
fi
. "$(dirname -- "$0")/backup-common.sh"
archive=$1
[ -f "$archive" ] || die 'Backup archive does not exist.'
archive="$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd)/$(basename -- "$archive")"
stage=$(mktemp -d)
check_archive

dc up -d --wait db >&2
lock_database
running=$(dc ps --services --status running)
if printf '%s\n' "$running" | grep -qx api; then die 'Stop API before restoring.'; fi
objects=$(sql -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'")
[ "$objects" = 0 ] || die 'Target database must be empty. Use a new Compose project.'
media 'test -z "$(find /var/lib/nir/media -mindepth 1 -print -quit)"' || die 'Target media volume must be empty.'
grep -qx 'format=1' "$stage/metadata.txt" || die 'Unsupported backup format.'
source_major=$(sed -n 's/^postgres_major=//p' "$stage/metadata.txt")
[ "$source_major" = "$(pg_major)" ] || die 'PostgreSQL major version differs from the backup.'
dc exec -T db pg_restore --list < "$stage/database.dump" >/dev/null

media 'exec tar -xf - -C /var/lib/nir/media --no-same-owner --no-same-permissions' < "$stage/media.tar"
media "$inventory" > "$stage/restored-files.sha256"
cmp "$stage/media-files.sha256" "$stage/restored-files.sha256" || die 'Restored file inventory differs.'
file_count=$(wc -l < "$stage/restored-files.sha256" | tr -d ' ')
grep -qx "media_files=$file_count" "$stage/metadata.txt" || die 'Restored file count differs.'
if [ -s "$stage/ready-files.sha256" ]; then
    media 'cd /var/lib/nir/media; sha256sum --strict -c -' < "$stage/ready-files.sha256" >&2
fi
# A failed restore transaction cannot leave half-created SQL tables.
dc exec -T db sh -c 'exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$stage/database.dump"
sql -c "COPY (SELECT encode(sha256,'hex') || '  ' || storage_key FROM media WHERE state='ready' ORDER BY storage_key) TO STDOUT" > "$stage/restored-ready.sha256"
cmp "$stage/ready-files.sha256" "$stage/restored-ready.sha256" || die 'Restored database media keys differ.'
expected_schema=$(sed -n 's/^schema_version=//p' "$stage/metadata.txt")
[ "$expected_schema" = "$(schema_version)" ] || die 'Restored schema version differs.'
sql -c 'BEGIN; DELETE FROM sessions; DELETE FROM mutation_receipts; COMMIT;' >&2
media 'chown -R app:app /var/lib/nir/media; chmod -R u+rwX,go-rwx /var/lib/nir/media'
echo 'Restore verified. Start the matching code with docker compose up -d --wait.' >&2
