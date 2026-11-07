package httpapi

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"nir18/backend/internal/auth"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Config struct {
	Origin, MediaDir                             string
	Secure, TrustProxy                           bool
	LoginPairLimit, LoginIPLimit, TemporaryFiles int
	TemporaryBytes                               int64
}
type Server struct {
	db                *pgxpool.Pool
	cfg               Config
	dummy             string
	passwords, images chan struct{}
	mu                sync.Mutex
	attempts          map[string]attempt
}
type attempt struct {
	Count int
	Until time.Time
}
type apiError struct {
	status int
	code   string
	fields map[string]string
}

func (e *apiError) Error() string { return e.code }
func fail(s int, c string) error  { return &apiError{s, c, map[string]string{}} }

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func uuid() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func New(pool *pgxpool.Pool, cfg Config) (*Server, error) {
	for _, setting := range []struct {
		name     string
		target   *int
		fallback int
	}{
		{"LOGIN_PAIR_LIMIT", &cfg.LoginPairLimit, 5}, {"LOGIN_IP_LIMIT", &cfg.LoginIPLimit, 30}, {"TEMP_MEDIA_COUNT", &cfg.TemporaryFiles, 100},
	} {
		if *setting.target == 0 {
			*setting.target = setting.fallback
			if v := os.Getenv(setting.name); v != "" {
				n, err := strconv.Atoi(v)
				if err != nil || n < 1 || n > 100000 {
					return nil, fmt.Errorf("invalid %s", setting.name)
				}
				*setting.target = n
			}
		}
	}
	if cfg.TemporaryBytes == 0 {
		cfg.TemporaryBytes = 500 << 20
		if v := os.Getenv("TEMP_MEDIA_BYTES"); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n < 1 {
				return nil, fmt.Errorf("invalid TEMP_MEDIA_BYTES")
			}
			cfg.TemporaryBytes = n
		}
	}
	u, e := url.Parse(cfg.Origin)
	if e != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("invalid APP_ORIGIN")
	}
	if u.Scheme == "https" && !cfg.Secure {
		return nil, fmt.Errorf("HTTPS requires COOKIE_SECURE=true")
	}
	if u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return nil, fmt.Errorf("HTTP allowed only on loopback")
	}
	if cfg.MediaDir == "" {
		return nil, fmt.Errorf("MEDIA_DIR required")
	}
	if e = os.MkdirAll(cfg.MediaDir+"/.incoming", 0700); e != nil {
		return nil, e
	}
	dummy, e := auth.Hash(uuid())
	if e != nil {
		return nil, e
	}
	return &Server{db: pool, cfg: cfg, dummy: dummy, passwords: make(chan struct{}, 2), images: make(chan struct{}, 2), attempts: make(map[string]attempt)}, nil
}
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.Handle("/api/health/", Router(s.db))
	for route, h := range map[string]func(http.ResponseWriter, *http.Request) error{
		"POST /api/auth/login": s.login, "GET /api/auth/me": s.me, "POST /api/auth/logout": s.logout,
		"GET /api/directions": s.catalog, "GET /api/subtopics": s.catalog, "GET /api/authors": s.catalog,
		"GET /api/publications": s.list, "GET /api/publications/{id}": s.read,
		"POST /api/publications": s.mutate, "PUT /api/publications/{id}": s.mutate, "DELETE /api/publications/{id}": s.mutate,
		"POST /api/media": s.upload, "POST /api/media/lease": s.lease, "GET /media/{id}": s.media,
	} {
		m.HandleFunc(route, s.wrap(h))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", uuid())
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		m.ServeHTTP(w, r)
	})
}
func (s *Server) wrap(h func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusWriter{ResponseWriter: w, status: 200}
		w = recorder
		err := h(w, r)
		status := recorder.status
		if err != nil {
			var a *apiError
			if !errors.As(err, &a) {
				a = &apiError{503, "unavailable", map[string]string{}}
			}
			status = a.status
			if status == 429 && w.Header().Get("Retry-After") == "" {
				w.Header().Set("Retry-After", "60")
			}
			respond(w, status, map[string]any{"error": map[string]any{"code": a.code, "message": message(a.code), "fields": a.fields}, "request_id": w.Header().Get("X-Request-ID")})
		}
		slog.Info("request", "request_id", w.Header().Get("X-Request-ID"), "route", r.Pattern, "status", status, "duration", time.Since(start))
	}
}
func message(code string) string {
	switch code {
	case "invalid_credentials":
		return "Неверный логин или пароль"
	case "unauthenticated":
		return "Войдите в аккаунт"
	case "stale_publication":
		return "Статья уже изменена; откройте свежую версию"
	case "validation_failed":
		return "Проверьте поля"
	case "forbidden":
		return "Недостаточно прав"
	case "unavailable", "storage_unavailable":
		return "Сервис временно недоступен"
	}
	return "Запрос не выполнен: " + code
}
func query(r *http.Request, allowed ...string) error {
	q, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil {
		return fail(400, "bad_request")
	}
	for k, v := range q {
		ok := false
		for _, a := range allowed {
			if a == k {
				ok = true
			}
		}
		if !ok || len(v) != 1 {
			return fail(400, "bad_request")
		}
	}
	return nil
}
func noBody(r *http.Request) error {
	b, e := io.ReadAll(io.LimitReader(r.Body, 1))
	if e != nil || len(b) != 0 {
		return fail(400, "bad_request")
	}
	return nil
}

// Reject duplicate keys recursively before decoding into typed structs.
func jsonValue(d *json.Decoder) error { return jsonValueDepth(d, 0) }
func jsonValueDepth(d *json.Decoder, depth int) error {
	if depth > 64 {
		return fmt.Errorf("JSON nesting limit")
	}
	t, e := d.Token()
	if e != nil {
		return e
	}
	if value, ok := t.(string); ok && strings.ContainsRune(value, 0) {
		return fmt.Errorf("NUL is not supported by PostgreSQL text")
	}
	if t == nil {
		return fmt.Errorf("null is not allowed")
	}
	if c, ok := t.(json.Delim); ok {
		switch c {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return e
				}
				s, ok := k.(string)
				if !ok || seen[s] {
					return fmt.Errorf("duplicate key")
				}
				seen[s] = true
				if e = jsonValueDepth(d, depth+1); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e = jsonValueDepth(d, depth+1); e != nil {
					return e
				}
			}
		default:
			return fmt.Errorf("delimiter")
		}
		_, e = d.Token()
		return e
	}
	return nil
}
func decode(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	mt, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || mt != "application/json" {
		return fail(415, "unsupported_media_type")
	}
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if e != nil {
		var max *http.MaxBytesError
		if errors.As(e, &max) {
			return fail(413, "payload_too_large")
		}
		return fail(400, "bad_request")
	}
	if !utf8.Valid(b) {
		return fail(400, "bad_request")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	if e = jsonValue(d); e != nil {
		return fail(400, "bad_request")
	}
	if _, e = d.Token(); e != io.EOF {
		return fail(400, "bad_request")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e = d.Decode(v); e != nil {
		return fail(400, "bad_request")
	}
	return nil
}
func (s *Server) origin(r *http.Request) error {
	if r.Header.Get("Origin") != s.cfg.Origin {
		return fail(403, "csrf_failed")
	}
	return nil
}
func validID(id string) error {
	if !uuidPattern.MatchString(id) {
		return fail(400, "bad_request")
	}
	return nil
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }
