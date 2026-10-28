// Package migrations applies embedded, immutable SQL files in order.
package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed *.sql
var Files embed.FS

const LatestVersion = 2

func Apply(ctx context.Context, conn *pgx.Conn) error {
	// A session lock covers both history creation and all migrations.
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock(181802)"); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(181802)")
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
 version bigint PRIMARY KEY, name text NOT NULL UNIQUE,
 checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
 applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	names, err := fs.Glob(Files, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	applied := map[int64]string{}
	rows, err := conn.Query(ctx, "SELECT version, checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return err
	}
	for rows.Next() {
		var v int64
		var h string
		if err := rows.Scan(&v, &h); err != nil {
			rows.Close()
			return err
		}
		applied[v] = h
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(applied) > len(names) {
		return fmt.Errorf("database has newer migrations than this binary")
	}
	for i, name := range names {
		version, err := strconv.ParseInt(strings.SplitN(name, "_", 2)[0], 10, 64)
		if err != nil || version != int64(i+1) {
			return fmt.Errorf("invalid migration sequence: %s", name)
		}
		sql, err := Files.ReadFile(name)
		if err != nil {
			return err
		}
		hash := fmt.Sprintf("%x", sha256.Sum256(sql))
		if old, ok := applied[version]; ok {
			if old != hash {
				return fmt.Errorf("checksum mismatch: %s", name)
			}
			continue
		}
		// No holes or unknown future versions are allowed.
		for v := range applied {
			if v > version {
				return fmt.Errorf("migration history has a gap before %s", name)
			}
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(sql)); err == nil {
			_, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)", version, name, hash)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
