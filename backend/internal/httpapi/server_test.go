package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"nir18/backend/internal/auth"
	"nir18/backend/migrations"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestJSONAndMarkdownValidation(t *testing.T) {
	for _, body := range []string{`{"x":null}`, `{"x":1,"x":2}`, `{"x":1} {}`, `{"unknown":1}`, `{"x":"a"}`, `[]`, strings.Repeat("[", 1000) + "0" + strings.Repeat("]", 1000)} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		var v struct {
			X int `json:"x"`
		}
		if decode(httptest.NewRecorder(), r, &v, 1024) == nil {
			t.Errorf("accepted %s", body)
		}
	}
	ids, e := mediaIDs("`![x](https://example.com)`\n![a](/media/30000000-0000-4000-8000-000000000001)\n![b](/media/30000000-0000-4000-8000-000000000001)")
	if e != nil || len(ids) != 1 {
		t.Fatal(ids, e)
	}
	if _, e = mediaIDs("![x](https://example.com)"); e == nil {
		t.Fatal("external media accepted")
	}
}
func TestPassword(t *testing.T) {
	h, e := auth.Hash("test-password-123")
	if e != nil || !auth.Verify("test-password-123", h) || auth.Verify("wrong-password-123", h) || auth.Verify("x", "$invalid") {
		t.Fatal("password hashing")
	}
}

// Requires an explicitly disposable database. Each run uses its own schema.
func TestAPIIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable PostgreSQL")
	}
	ctx := context.Background()
	admin, e := pgx.Connect(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close(ctx)
	schema := "test_" + strings.ReplaceAll(uuid(), "-", "")
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	cfg.MaxConns = 8
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	c, e := db.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	e = migrations.Apply(ctx, c.Conn())
	c.Release()
	if e != nil {
		t.Fatal(e)
	}
	hash, _ := auth.Hash("test-password-123")
	_, e = db.Exec(ctx, "UPDATE users SET password_hash=$1,is_active=true WHERE login IN ('fmavrin','akomarov')", hash)
	if e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	s, e := New(db, Config{Origin: "http://localhost:8080", MediaDir: dir})
	if e != nil {
		t.Fatal(e)
	}
	h := s.Handler()
	request := func(method, path, body string, a *session, cookie *http.Cookie, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:2000"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://localhost:8080")
		if a != nil {
			r.Header.Set("X-CSRF-Token", a.CSRF)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	check := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d, got %d: %s", status, w.Code, w.Body.String())
		}
	}
	login := func(name string) (*session, *http.Cookie) {
		w := request("POST", "/api/auth/login", `{"login":"`+name+`","password":"test-password-123"}`, nil, nil, nil)
		check(w, 200)
		var a session
		if e = json.Unmarshal(w.Body.Bytes(), &a); e != nil {
			t.Fatal(e)
		}
		cookie := w.Result().Cookies()[0]
		if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatal("cookie flags")
		}
		return &a, cookie
	}
	a, ca := login("fmavrin")
	b, cb := login("akomarov")
	check(request("GET", "/api/auth/me", "", nil, ca, nil), 200)
	check(request("GET", "/api/auth/me", "", nil, nil, nil), 401)
	for _, path := range []string{"/api/directions", "/api/subtopics?direction_id=1", "/api/authors"} {
		check(request("GET", path, "", nil, nil, nil), 200)
	}
	check(request("GET", "/api/subtopics?direction_id=999", "", nil, nil, nil), 422)
	check(request("GET", "/api/publications?page=1&page=2", "", nil, nil, nil), 400)
	check(request("GET", "/api/publications?direction_id=1&subtopic_id=201", "", nil, nil, nil), 422)
	check(request("GET", "/api/publications?date_from=5812-03-12", "", nil, nil, nil), 422)
	check(request("GET", "/api/publications?date_to=2026-09-30", "", nil, nil, nil), 422)
	check(request("GET", "/api/publications?date_from=2026-11-08&date_to=2026-11-07", "", nil, nil, nil), 422)
	body := `{"title":"Тест 100%_","subtopic_id":101,"markdown":"Наука"}`
	key := uuid()
	headers := map[string]string{"Idempotency-Key": key}
	check(request("POST", "/api/publications", body, nil, nil, headers), 401)
	check(request("POST", "/api/publications", body, nil, ca, headers), 403)
	check(request("POST", "/api/publications", body, a, ca, map[string]string{"Origin": "https://evil.example"}), 403)
	check(request("POST", "/api/publications", body, a, ca, nil), 428)
	check(request("POST", "/api/publications", `{"title":"x","title":"y","markdown":"x","subtopic_id":101}`, a, ca, headers), 400)
	w := request("POST", "/api/publications", body, a, ca, headers)
	check(w, 201)
	var saved map[string]string
	json.Unmarshal(w.Body.Bytes(), &saved)
	id := saved["id"]
	etag := w.Header().Get("ETag")
	check(request("POST", "/api/publications", strings.Replace(body, "Наука", "Другое", 1), a, ca, headers), 409)
	replay := request("POST", "/api/publications", body, a, ca, headers)
	check(replay, 201)
	if replay.Header().Get("Idempotency-Replayed") != "true" || replay.Body.String() != w.Body.String() {
		t.Fatal("replay differs")
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x := request("POST", "/api/publications", body, a, ca, headers)
			if x.Code != 201 {
				t.Errorf("parallel retry %d", x.Code)
			}
		}()
	}
	wg.Wait()
	w = request("GET", "/api/publications?q=100%25_", "", nil, nil, nil)
	check(w, 200)
	if !strings.Contains(w.Body.String(), `"total":1`) {
		t.Fatal(w.Body.String())
	}

	// Moscow 7 November starts on 6 November at 21:00 UTC.
	if _, e = db.Exec(ctx, "UPDATE publications SET updated_at='2026-11-06T21:00:00Z' WHERE id=$1", id); e != nil {
		t.Fatal(e)
	}
	for _, item := range []struct{ day, total string }{{"2026-11-07", "1"}, {"2026-11-06", "0"}} {
		x := request("GET", "/api/publications?date_from="+item.day+"&date_to="+item.day, "", nil, nil, nil)
		check(x, 200)
		if !strings.Contains(x.Body.String(), `"total":`+item.total) {
			t.Fatal("date boundary", x.Body.String())
		}
	}
	for _, method := range []string{"PUT", "DELETE"} {
		payload := body
		if method == "DELETE" {
			payload = ""
		}
		check(request(method, "/api/publications/"+id, payload, b, cb, map[string]string{"Idempotency-Key": uuid(), "If-Match": etag}), 403)
	}
	check(request("PUT", "/api/publications/"+id, body, a, ca, map[string]string{"Idempotency-Key": uuid(), "If-Match": "\"" + uuid() + "\""}), 412)
	w = request("PUT", "/api/publications/"+id, body, a, ca, map[string]string{"Idempotency-Key": uuid(), "If-Match": etag})
	check(w, 200)
	newTag := w.Header().Get("ETag")
	if newTag == etag {
		t.Fatal("revision unchanged")
	}
	upload := func(id string, data []byte) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		m := multipart.NewWriter(&buf)
		m.WriteField("upload_id", id)
		f, _ := m.CreateFormFile("file", "image.png")
		f.Write(data)
		m.Close()
		return request("POST", "/api/media", buf.String(), a, ca, map[string]string{"Content-Type": m.FormDataContentType()})
	}
	var img bytes.Buffer
	png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 3, 2)))
	mid := uuid()
	check(upload(mid, img.Bytes()), 201)
	check(upload(mid, img.Bytes()), 200)
	check(upload(uuid(), []byte("not an image")), 415)
	check(request("GET", "/media/"+mid, "", nil, nil, nil), 404)
	check(request("GET", "/media/"+mid, "", nil, cb, nil), 404)
	check(request("GET", "/media/"+mid, "", nil, ca, nil), 200)
	// Private reads must not exhaust the pool by acquiring a second connection.
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x := request("GET", "/media/"+mid, "", nil, ca, nil)
			if x.Code != 200 {
				t.Errorf("private concurrent read: %d", x.Code)
			}
		}()
	}
	wg.Wait()
	var beforeLease string
	db.QueryRow(ctx, "SELECT lease_until::text FROM media WHERE id=$1", mid).Scan(&beforeLease)
	check(request("POST", "/api/media/lease", `{"ids":["`+mid+`","`+uuid()+`"]}`, a, ca, nil), 404)
	var afterLease string
	db.QueryRow(ctx, "SELECT lease_until::text FROM media WHERE id=$1", mid).Scan(&afterLease)
	if beforeLease != afterLease {
		t.Fatal("partial lease update")
	}

	imgbody := `{"title":"Image","subtopic_id":101,"markdown":"![x](/media/` + mid + `)"}`
	check(request("POST", "/api/publications", imgbody, b, cb, map[string]string{"Idempotency-Key": uuid()}), 422)
	w = request("PUT", "/api/publications/"+id, imgbody, a, ca, map[string]string{"Idempotency-Key": uuid(), "If-Match": newTag})
	check(w, 200)
	newTag = w.Header().Get("ETag")
	// Cleanup must preserve linked files even if their old lease expired.
	_, e = db.Exec(ctx, "UPDATE media SET uploaded_at=now()-interval '2 days',lease_until=now()-interval '1 day' WHERE id=$1", mid)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Cleanup(ctx); e != nil {
		t.Fatal(e)
	}
	var mediaCount int
	if e = db.QueryRow(ctx, "SELECT count(*) FROM media WHERE id=$1", mid).Scan(&mediaCount); e != nil || mediaCount != 1 {
		t.Fatal("linked file removed", e)
	}
	w = request("GET", "/media/"+mid, "", nil, nil, nil)
	check(w, 200)
	if !bytes.Equal(w.Body.Bytes(), img.Bytes()) {
		t.Fatal("media bytes differ")
	}
	w = request("HEAD", "/media/"+mid, "", nil, nil, nil)
	check(w, 200)
	if w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD")
	}
	check(request("POST", "/api/media/lease", `{"ids":["`+mid+`"]}`, b, cb, nil), 404)
	check(request("POST", "/api/media/lease", `{"ids":["`+mid+`"]}`, a, ca, nil), 200)
	// Missing physical file returns 503, not an empty successful image.
	p := filepath.Join(dir, mid+".png")
	data, _ := os.ReadFile(p)
	os.Remove(p)
	check(request("GET", "/media/"+mid, "", nil, nil, nil), 503)
	os.WriteFile(p, data, 0600)
	del := map[string]string{"Idempotency-Key": uuid(), "If-Match": newTag}
	check(request("DELETE", "/api/publications/"+id, "", a, ca, del), 204)
	check(request("DELETE", "/api/publications/"+id, "", a, ca, del), 204)
	check(request("GET", "/api/publications/"+id, "", nil, nil, nil), 404)
	check(request("GET", "/media/"+mid, "", nil, nil, nil), 404)
	if e = s.Cleanup(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(p); e != nil {
		t.Fatal("leased file removed")
	}
	_, e = db.Exec(ctx, "UPDATE media SET uploaded_at=now()-interval '2 days',lease_until=now()-interval '1 day' WHERE id=$1", mid)
	if e != nil {
		t.Fatal(e)
	}
	check(request("POST", "/api/media/lease", `{"ids":["`+mid+`"]}`, a, ca, nil), 409)
	if e = s.Cleanup(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("expired file remains")
	}
	check(request("POST", "/api/auth/logout", "", a, ca, nil), 204)
	check(request("GET", "/api/auth/me", "", nil, ca, nil), 401)
	check(request("POST", "/api/auth/logout", "", nil, ca, nil), 204)
	for range 5 {
		check(request("POST", "/api/auth/login", `{"login":"unknown","password":"wrong-password-123"}`, nil, nil, nil), 401)
	}
	check(request("POST", "/api/auth/login", `{"login":"unknown","password":"wrong-password-123"}`, nil, nil, nil), 429)
	// A revoked session cannot be used for mutation even after it was read.
	_, e = db.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", b.User.ID)
	if e != nil {
		t.Fatal(e)
	}
	check(request("POST", "/api/publications", body, b, cb, headers), 401)
}
