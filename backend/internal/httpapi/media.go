package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"github.com/jackc/pgx/v5"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func availableMedia(r *http.Request, tx pgx.Tx, id, owner string, hidden bool) error {
	var actual, state string
	var available bool
	e := tx.QueryRow(r.Context(), `SELECT owner_id::text,state,lease_until>now() OR EXISTS(SELECT 1 FROM publication_media WHERE media_id=media.id) FROM media WHERE id=$1 FOR UPDATE`, id).Scan(&actual, &state, &available)
	if errors.Is(e, pgx.ErrNoRows) || e == nil && actual != owner {
		if hidden {
			return fail(404, "not_found")
		}
		return &apiError{422, "validation_failed", map[string]string{"media_ids": "Изображение отсутствует или принадлежит другому автору"}}
	}
	if e != nil {
		return e
	}
	if state != "ready" || !available {
		return fail(409, "media_unavailable")
	}
	return nil
}

type mediaResult struct {
	ID     string    `json:"id"`
	URL    string    `json:"url"`
	MIME   string    `json:"mime_type"`
	Size   int64     `json:"byte_size"`
	Width  int       `json:"width"`
	Height int       `json:"height"`
	Lease  time.Time `json:"lease_until"`
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	a, e := s.authorize(r)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	if r.ContentLength > 6<<20 {
		return fail(413, "payload_too_large")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	mr, e := r.MultipartReader()
	if e != nil {
		return fail(415, "unsupported_media_type")
	}
	select {
	case s.images <- struct{}{}:
		defer func() { <-s.images }()
	case <-ctx.Done():
		return ctx.Err()
	}
	var id, name string
	var data []byte
	fields := map[string]bool{}
	for {
		p, e := mr.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			return uploadReadError(e)
		}
		k := p.FormName()
		if fields[k] || (k != "upload_id" && k != "file") {
			p.Close()
			return fail(400, "bad_request")
		}
		fields[k] = true
		if k == "upload_id" {
			if p.FileName() != "" {
				return fail(400, "bad_request")
			}
			b, e := io.ReadAll(io.LimitReader(p, 100))
			if e != nil {
				return uploadReadError(e)
			}
			id = string(b)
		} else {
			if p.FileName() == "" {
				return fail(400, "bad_request")
			}
			name = filepath.Base(strings.ReplaceAll(p.FileName(), `\`, "/"))
			data, e = io.ReadAll(io.LimitReader(p, (5<<20)+1))
			if e != nil {
				return uploadReadError(e)
			}
			if len(data) > 5<<20 {
				return fail(413, "payload_too_large")
			}
		}
		p.Close()
	}
	if _, e = io.Copy(io.Discard, r.Body); e != nil {
		return uploadReadError(e)
	}
	if len(fields) != 2 || validID(id) != nil {
		return fail(400, "bad_request")
	}
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 || strings.TrimSpace(name) == "" {
		return fail(422, "validation_failed")
	}
	detected := http.DetectContentType(data)
	if detected != "image/png" && detected != "image/jpeg" && detected != "image/webp" {
		return fail(415, "unsupported_media_type")
	}
	config, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil {
		return fail(422, "invalid_image")
	}
	ext := map[string]string{"png": "png", "jpeg": "jpg", "webp": "webp"}[format]
	if ext == "" {
		return fail(415, "unsupported_media_type")
	}
	if config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 20000000 {
		return fail(422, "invalid_image")
	}
	if _, _, e = image.Decode(bytes.NewReader(data)); e != nil {
		return fail(422, "invalid_image")
	}
	result := mediaResult{ID: id, URL: "/media/" + id, MIME: "image/" + format, Size: int64(len(data)), Width: config.Width, Height: config.Height}
	hash := sha256.Sum256(data)
	tx, e := s.writeTx(r, a)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var owner, state string
	var old []byte
	e = tx.QueryRow(ctx, "SELECT owner_id::text,state,sha256,mime_type,byte_size,width,height,lease_until FROM media WHERE id=$1 FOR UPDATE", id).Scan(&owner, &state, &old, &result.MIME, &result.Size, &result.Width, &result.Height, &result.Lease)
	if e == nil {
		if owner != a.User.ID {
			return fail(404, "not_found")
		}
		if !bytes.Equal(hash[:], old) {
			return fail(409, "idempotency_conflict")
		}
		if state == "staging" {
			w.Header().Set("Retry-After", "2")
			return fail(409, "upload_in_progress")
		}
		if e = availableMedia(r, tx, id, a.User.ID, true); e != nil {
			return e
		}
		respond(w, 200, result)
		return nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	var count int
	var size int64
	e = tx.QueryRow(ctx, `SELECT count(*),COALESCE(sum(byte_size),0) FROM media m WHERE owner_id=$1 AND NOT EXISTS(SELECT 1 FROM publication_media WHERE media_id=m.id)`, a.User.ID).Scan(&count, &size)
	if e != nil {
		return e
	}
	if count >= s.cfg.TemporaryFiles || size+int64(len(data)) > s.cfg.TemporaryBytes {
		return fail(429, "rate_limited")
	}
	storage := id + "." + ext
	e = tx.QueryRow(ctx, `INSERT INTO media(id,owner_id,storage_key,original_name,mime_type,byte_size,width,height,sha256,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '24 hours') ON CONFLICT(id) DO NOTHING RETURNING lease_until`, id, a.User.ID, storage, name, result.MIME, result.Size, result.Width, result.Height, hash[:]).Scan(&result.Lease)
	if errors.Is(e, pgx.ErrNoRows) {
		return fail(404, "not_found")
	}
	if e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	incoming := filepath.Join(s.cfg.MediaDir, ".incoming", id)
	final := filepath.Join(s.cfg.MediaDir, storage)
	file, e := os.OpenFile(incoming, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return fail(503, "storage_unavailable")
	}
	_, e = file.Write(data)
	if e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e != nil || closeErr != nil {
		return fail(503, "storage_unavailable")
	}
	// Link atomically installs without overwriting. Both paths are on the same volume.
	if e = os.Link(incoming, final); e != nil {
		return fail(503, "storage_unavailable")
	}
	if e = syncDir(s.cfg.MediaDir); e != nil {
		return fail(503, "storage_unavailable")
	}
	if e = os.Remove(incoming); e != nil {
		return fail(503, "storage_unavailable")
	}
	if e = syncDir(filepath.Dir(incoming)); e != nil {
		return fail(503, "storage_unavailable")
	}
	tx, e = s.writeTx(r, a)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, "UPDATE media SET state='ready' WHERE id=$1 AND state='staging'", id)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return fail(409, "media_unavailable")
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	respond(w, 201, result)
	return nil
}
func uploadReadError(e error) error {
	var max *http.MaxBytesError
	if errors.As(e, &max) {
		return fail(413, "payload_too_large")
	}
	return fail(400, "bad_request")
}
func syncDir(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
func (s *Server) lease(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	a, e := s.authorize(r)
	if e != nil {
		return e
	}
	var in struct {
		IDs []string `json:"ids"`
	}
	if e = decode(w, r, &in, 8192); e != nil {
		return e
	}
	if len(in.IDs) < 1 || len(in.IDs) > 100 {
		return fail(422, "validation_failed")
	}
	sort.Strings(in.IDs)
	for i, id := range in.IDs {
		if e = validID(id); e != nil {
			return e
		}
		if i > 0 && id == in.IDs[i-1] {
			return fail(422, "validation_failed")
		}
	}
	tx, e := s.writeTx(r, a)
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	for _, id := range in.IDs {
		if e = availableMedia(r, tx, id, a.User.ID, true); e != nil {
			return e
		}
	}
	var until time.Time
	if e = tx.QueryRow(r.Context(), "SELECT clock_timestamp()+interval '24 hours'").Scan(&until); e != nil {
		return e
	}
	for _, id := range in.IDs {
		if _, e = tx.Exec(r.Context(), "UPDATE media SET lease_until=GREATEST(lease_until,$2) WHERE id=$1", id, until); e != nil {
			return e
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	respond(w, 200, map[string]any{"lease_until": until})
	return nil
}
func (s *Server) media(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	id := r.PathValue("id")
	if e := validID(id); e != nil {
		return e
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var owner, state, key, mime string
	var public, leased bool
	var size int64
	e = tx.QueryRow(r.Context(), `SELECT owner_id::text,state,storage_key,mime_type,byte_size,lease_until>now(),EXISTS(SELECT 1 FROM publication_media WHERE media_id=media.id) FROM media WHERE id=$1 FOR SHARE`, id).Scan(&owner, &state, &key, &mime, &size, &leased, &public)
	if errors.Is(e, pgx.ErrNoRows) {
		return fail(404, "not_found")
	}
	if e != nil {
		return e
	}
	if state != "ready" {
		return fail(404, "not_found")
	}
	if !public {
		if !leased {
			return fail(404, "not_found")
		}
		a := session{}
		e := tx.QueryRow(r.Context(), sessionSQL, sessionHash(r)).Scan(&a.User.ID, &a.User.Name, &a.User.Login, &a.CSRF, &a.Expires)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return fail(404, "not_found")
			}
			return e
		}
		if a.User.ID != owner {
			return fail(404, "not_found")
		}
	}
	f, e := os.Open(filepath.Join(s.cfg.MediaDir, key))
	if e != nil {
		return fail(503, "storage_unavailable")
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || info.Size() != size {
		return fail(503, "storage_unavailable")
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		_, _ = io.Copy(w, f)
	}
	return nil
}

// Cleanup never scans unknown files while uploads run. Staging is retained for an hour.
func (s *Server) Cleanup(ctx context.Context) error {
	for {
		tx, e := s.db.Begin(ctx)
		if e != nil {
			return e
		}
		var id, key string
		e = tx.QueryRow(ctx, `SELECT id::text,storage_key FROM media m WHERE NOT EXISTS(SELECT 1 FROM publication_media WHERE media_id=m.id) AND (state='deleting' OR state='staging' AND uploaded_at<now()-interval '1 hour' OR state='ready' AND lease_until<now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&id, &key)
		if errors.Is(e, pgx.ErrNoRows) {
			tx.Rollback(ctx)
			break
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		// Recheck links after acquiring the lock, in a fresh READ COMMITTED statement.
		tag, e := tx.Exec(ctx, "UPDATE media SET state='deleting' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM publication_media WHERE media_id=$1) AND (state='deleting' OR state='staging' AND uploaded_at<now()-interval '1 hour' OR state='ready' AND lease_until<now())", id)
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		for _, p := range []string{filepath.Join(s.cfg.MediaDir, key), filepath.Join(s.cfg.MediaDir, ".incoming", id)} {
			e = os.Remove(p)
			if e != nil && !errors.Is(e, os.ErrNotExist) {
				return e
			}
		}
		if e = syncDir(s.cfg.MediaDir); e != nil {
			return e
		}
		if e = syncDir(filepath.Join(s.cfg.MediaDir, ".incoming")); e != nil {
			return e
		}
		if _, e = s.db.Exec(ctx, "DELETE FROM media WHERE id=$1 AND state='deleting'", id); e != nil {
			return e
		}
	}
	_, e := s.db.Exec(ctx, "DELETE FROM sessions WHERE expires_at<=now()")
	if e != nil {
		return e
	}
	_, e = s.db.Exec(ctx, "DELETE FROM mutation_receipts WHERE expires_at<=now()")
	return e
}
