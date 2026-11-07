package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"github.com/jackc/pgx/v5"
	"net"
	"net/http"
	"nir18/backend/internal/auth"
	"regexp"
	"strings"
	"time"
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"display_name"`
	Login string `json:"login"`
}
type session struct {
	User    User      `json:"user"`
	CSRF    string    `json:"csrf_token"`
	Expires time.Time `json:"expires_at"`
	hash    []byte
}

func randomToken() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func sessionHash(r *http.Request) []byte {
	c, e := r.Cookie("nir_session")
	if e != nil || len(c.Value) != 64 {
		return nil
	}
	b, e := hex.DecodeString(c.Value)
	if e != nil {
		return nil
	}
	h := sha256.Sum256(b)
	return h[:]
}

const sessionSQL = `SELECT u.id::text,u.display_name,u.login,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active`

func (s *Server) session(r *http.Request) (*session, error) {
	h := sessionHash(r)
	if h == nil {
		return nil, fail(401, "unauthenticated")
	}
	a := &session{hash: h}
	e := s.db.QueryRow(r.Context(), sessionSQL, h).Scan(&a.User.ID, &a.User.Name, &a.User.Login, &a.CSRF, &a.Expires)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fail(401, "unauthenticated")
	}
	return a, e
}
func (s *Server) authorize(r *http.Request) (*session, error) {
	if e := s.origin(r); e != nil {
		return nil, e
	}
	a, e := s.session(r)
	if e != nil {
		return nil, e
	}
	if subtle.ConstantTimeCompare([]byte(a.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
		return nil, fail(403, "csrf_failed")
	}
	return a, nil
}

// Serialize writes for one owner, including password resets, and recheck revocation.
func (s *Server) writeTx(r *http.Request, a *session) (pgx.Tx, error) {
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", a.User.ID)
	if e == nil {
		var ok bool
		e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active)", a.hash).Scan(&ok)
		if e == nil && !ok {
			e = fail(401, "unauthenticated")
		}
	}
	if e != nil {
		tx.Rollback(r.Context())
		return nil, e
	}
	return tx, nil
}
func (s *Server) cookie(w http.ResponseWriter, value string, expires time.Time) {
	age := 7 * 24 * 3600
	if value == "" {
		age = -1
	}
	http.SetCookie(w, &http.Cookie{Name: "nir_session", Value: value, Path: "/", HttpOnly: true, Secure: s.cfg.Secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: age})
}
func (s *Server) reserveLogin(r *http.Request, login string) (func(bool), error) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if s.cfg.TrustProxy {
		if p := net.ParseIP(r.Header.Get("X-Nir-Client-IP")); p != nil {
			ip = p.String()
		}
	}
	keys := []string{"ip:" + ip, "pair:" + ip + ":" + login}
	limits := []int{s.cfg.LoginIPLimit, s.cfg.LoginPairLimit}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, a := range s.attempts {
		if now.After(a.Until) {
			delete(s.attempts, k)
		}
	}
	if len(s.attempts) > 10000 {
		return nil, fail(429, "rate_limited")
	}
	for i, k := range keys {
		if s.attempts[k].Count >= limits[i] {
			return nil, fail(429, "rate_limited")
		}
	}
	for _, k := range keys {
		a := s.attempts[k]
		if a.Count == 0 {
			a.Until = now.Add(15 * time.Minute)
		}
		a.Count++
		s.attempts[k] = a
	}
	return func(success bool) {
		if success {
			s.mu.Lock()
			defer s.mu.Unlock()
			for _, k := range keys {
				a := s.attempts[k]
				if a.Count > 0 {
					a.Count--
				}
				s.attempts[k] = a
			}
		}
	}, nil
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	if e := s.origin(r); e != nil {
		return e
	}
	var in struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if e := decode(w, r, &in, 4096); e != nil {
		return e
	}
	in.Login = strings.ToLower(strings.TrimSpace(in.Login))
	if !regexp.MustCompile(`^[a-z][a-z0-9_]{2,31}$`).MatchString(in.Login) || !auth.ValidPassword(in.Password) {
		return fail(422, "validation_failed")
	}
	finish, e := s.reserveLogin(r, in.Login)
	if e != nil {
		w.Header().Set("Retry-After", "900")
		return e
	}
	success := false
	defer func() { finish(success) }()
	select {
	case s.passwords <- struct{}{}:
		defer func() { <-s.passwords }()
	case <-r.Context().Done():
		return r.Context().Err()
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	a := session{}
	var hash string
	var active bool
	e = tx.QueryRow(r.Context(), "SELECT id::text,display_name,login,COALESCE(password_hash,''),is_active FROM users WHERE login=$1 FOR UPDATE", in.Login).Scan(&a.User.ID, &a.User.Name, &a.User.Login, &hash, &active)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	if !active {
		hash = s.dummy
	}
	ok := auth.Verify(in.Password, hash)
	if !ok || !active {
		return fail(401, "invalid_credentials")
	}
	token := randomToken()
	raw, _ := hex.DecodeString(token)
	h := sha256.Sum256(raw)
	a.CSRF = randomToken()
	if _, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", sessionHash(r)); e != nil {
		return e
	}
	e = tx.QueryRow(r.Context(), "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days') RETURNING expires_at", h[:], a.User.ID, a.CSRF).Scan(&a.Expires)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	success = true
	s.cookie(w, token, a.Expires)
	respond(w, 200, a)
	return nil
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	a, e := s.session(r)
	if e != nil {
		return e
	}
	respond(w, 200, a)
	return nil
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	if e := s.origin(r); e != nil {
		return e
	}
	a, e := s.session(r)
	if e != nil {
		var ae *apiError
		if !errors.As(e, &ae) || ae.status != 401 {
			return e
		}
	} else {
		if subtle.ConstantTimeCompare([]byte(a.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
			return fail(403, "csrf_failed")
		}
		tx, e := s.writeTx(r, a)
		if e != nil {
			return e
		}
		defer tx.Rollback(context.Background())
		if _, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", a.hash); e != nil {
			return e
		}
		if e = tx.Commit(r.Context()); e != nil {
			return e
		}
	}
	s.cookie(w, "", time.Unix(1, 0))
	w.WriteHeader(204)
	return nil
}
