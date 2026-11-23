#!/bin/sh
# Shared Docker Compose operations for backup.sh and restore.sh.
set -eu
umask 077
export MSYS_NO_PATHCONV=1
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }
dc() { docker compose "$@"; }
sql() {
    dc exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}
media() {
    dc run --rm --no-deps -T --user 0 --entrypoint sh api -ec "$1"
}

stage=
lock=
resume_api=false
cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$resume_api" = true ]; then
        if ! dc start --wait api >&2; then
            printf '%s\n' 'API restart failed. Run docker compose up -d api.' >&2
            result=1
        fi
    fi
    if [ -n "$stage" ]; then rm -rf -- "$stage"; fi
    if [ -n "$lock" ]; then docker rm "$lock" >/dev/null; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

for command in docker tar sha256sum mktemp; do
    command -v "$command" >/dev/null 2>&1 || die "Missing command: $command"
done
dc version >/dev/null

lock_database() {
    db_id=$(dc ps -q db)
    [ -n "$db_id" ] || die 'Start PostgreSQL first: docker compose up -d --wait db'
    # A Docker name is atomic and shared by all checkouts using this database.
    lock_name="nir18-backup-$db_id"
    image=$(docker inspect --format '{{.Image}}' "$db_id")
    if ! docker create --name "$lock_name" --entrypoint /bin/true "$image" >/dev/null; then
        die "Maintenance already running. Lock container: $lock_name"
    fi
    lock=$lock_name
}

pg_major() {
    version=$(sql -c 'SHOW server_version_num') || return 1
    echo "$((version / 10000))"
}
schema_version() { sql -c 'SELECT coalesce(max(version),0) FROM schema_migrations'; }

# The volume also contains in-progress uploads, which belong to the same snapshot.
inventory='cd /var/lib/nir/media
test -z "$(find . ! -type f ! -type d -print -quit)"
find . -type f -exec sha256sum {} + > /tmp/nir18-media-checksums
LC_ALL=C sort /tmp/nir18-media-checksums'

check_archive() {
    tar -tzf "$archive" | LC_ALL=C sort > "$stage/members"
    printf '%s\n' SHA256SUMS database.dump media.tar media-files.sha256 metadata.txt ready-files.sha256 | LC_ALL=C sort > "$stage/expected"
    cmp "$stage/members" "$stage/expected" || die 'Unexpected backup archive members.'
    tar -tvzf "$archive" > "$stage/types"
    if grep -qv '^-' "$stage/types"; then die 'Backup must contain regular files only.'; fi
    tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions
    # Accept only checksums for the five expected payloads.
    grep -E '^[0-9a-f]{64} [ *](database.dump|media.tar|media-files.sha256|metadata.txt|ready-files.sha256)$' "$stage/SHA256SUMS" > "$stage/valid-sums" || die 'Invalid checksum list.'
    cmp "$stage/SHA256SUMS" "$stage/valid-sums" || die 'Invalid checksum list.'
    cut -c 67- "$stage/SHA256SUMS" | LC_ALL=C sort > "$stage/sum-names"
    printf '%s\n' database.dump media.tar media-files.sha256 metadata.txt ready-files.sha256 | LC_ALL=C sort > "$stage/expected-sums"
    cmp "$stage/sum-names" "$stage/expected-sums" || die 'Incomplete checksum list.'
    (cd "$stage" && sha256sum --strict -c SHA256SUMS) >&2
    # Reject paths outside the volume, symbolic links, hard links and device nodes.
    tar -tf "$stage/media.tar" > "$stage/media-members"
    while IFS= read -r entry; do
        case "$entry" in ./*) ;; *) die 'Invalid media path.' ;; esac
        case "/$entry/" in */../*) die 'Invalid media parent path.' ;; esac
        printf '%s\n' "$entry" | grep -Eq '^\./[A-Za-z0-9_./-]*$' || die 'Invalid media filename.'
    done < "$stage/media-members"
    tar -tvf "$stage/media.tar" > "$stage/media-types"
    if grep -qv '^[-d]' "$stage/media-types"; then die 'Unsupported media file type.'; fi
}
