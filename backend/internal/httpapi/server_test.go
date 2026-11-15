package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"nir18/backend/internal/auth"
	"nir18/backend/internal/bot"
	"nir18/backend/migrations"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
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
	t.Run("Bot", func(t *testing.T) {
		testBotAPI(t, db, a, ca, b, cb, mid)
	})
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

type botResponderFunc func(context.Context, bot.Input) (bot.Output, error)

func (f botResponderFunc) Respond(ctx context.Context, input bot.Input) (bot.Output, error) {
	return f(ctx, input)
}

func testBotAPI(t *testing.T, db *pgxpool.Pool, a *session, ca *http.Cookie, b *session, cb *http.Cookie, mediaID string) {
	const origin = "http://localhost:8080"
	const route = "/api/bot/respond"
	const requestID = "40000000-0000-4000-8000-000000000001"
	const plain = `{"contract_version":"1.0","request_id":"` + requestID + `","topic":{"subtopic_id":101,"title":"Тема"},"message":"Заметки","history":[],"current_markdown":""}`
	image := "![Схема](/media/" + mediaID + ")"
	markdown, err := json.Marshal("Формула $\\alpha$\n\n" + image + "\n\n" + image)
	if err != nil {
		t.Fatal(err)
	}
	withMedia := strings.Replace(plain, `"current_markdown":""`, `"current_markdown":`+string(markdown), 1)

	newHandler := func(mode string, responder bot.Responder, limit int) http.Handler {
		t.Helper()
		s, err := New(db, Config{
			Origin: origin, MediaDir: t.TempDir(), BotMode: mode,
			BotResponder: responder, BotRequestsPerMinute: limit,
		})
		if err != nil {
			t.Fatal(err)
		}
		return s.Handler()
	}
	newRequest := func(ctx context.Context, path, body string, sess *session, cookie *http.Cookie) *http.Request {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)).WithContext(ctx)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		if sess != nil {
			r.Header.Set("X-CSRF-Token", sess.CSRF)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		return r
	}
	send := func(handler http.Handler, r *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	checkError := func(w *httptest.ResponseRecorder, status int, code string) {
		t.Helper()
		var payload struct {
			Error struct {
				Code   string            `json:"code"`
				Fields map[string]string `json:"fields"`
			} `json:"error"`
			RequestID string `json:"request_id"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil ||
			w.Code != status || payload.Error.Code != code || payload.Error.Fields == nil ||
			payload.RequestID == "" || payload.RequestID != w.Header().Get("X-Request-ID") {
			t.Fatalf("want %d %s, got %d: %s", status, code, w.Code, w.Body.String())
		}
	}
	checkSuccess := func(w *httptest.ResponseRecorder, mode, kind, id string) botResponse {
		t.Helper()
		var out botResponse
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != 200 ||
			out.Version != bot.ContractVersion || out.Mode != mode || out.Kind != kind ||
			out.Markdown == "" || out.Warnings == nil || out.RequestID != id || w.Header().Get("X-Request-ID") != id {
			t.Fatalf("invalid bot response %d: %s", w.Code, w.Body.String())
		}
		return out
	}

	ctx := context.Background()
	stub := newHandler("stub", nil, 100)
	checkError(send(stub, newRequest(ctx, route, plain, nil, nil)), 401, "unauthenticated")
	checkError(send(stub, newRequest(ctx, route, plain, nil, ca)), 403, "csrf_failed")
	wrongOrigin := newRequest(ctx, route, plain, a, ca)
	wrongOrigin.Header.Set("Origin", "https://example.org")
	checkError(send(stub, wrongOrigin), 403, "csrf_failed")
	badType := newRequest(ctx, route, plain, a, ca)
	badType.Header.Set("Content-Type", "text/plain")
	checkError(send(stub, badType), 415, "unsupported_media_type")
	checkError(send(stub, newRequest(ctx, route+"?extra=1", plain, a, ca)), 400, "bad_request")
	checkError(send(stub, newRequest(ctx, route, strings.Repeat(" ", (2<<20)+1), a, ca)), 413, "payload_too_large")
	for _, invalid := range []string{
		`{`,
		strings.Replace(plain, requestID, "invalid-id", 1),
		strings.Replace(plain, `"message":"Заметки"`, `"message":"Заметки","message":"Дубль"`, 1),
		strings.Replace(plain, `"message":`, `"Message":`, 1),
		strings.Replace(plain, `"title":`, `"TITLE":`, 1),
		strings.Replace(plain, `,"current_markdown":""`, "", 1),
		strings.Replace(plain, `"history":[]`, `"history":null`, 1),
		strings.Replace(plain, `"history":[]`, `"history":[{"role":"user","content":"x","extra":""}]`, 1),
	} {
		checkError(send(stub, newRequest(ctx, route, invalid, a, ca)), 400, "bad_request")
	}
	unsupported := send(stub, newRequest(ctx, route, strings.Replace(plain, `"1.0"`, `"2.0"`, 1), a, ca))
	checkError(unsupported, 422, "contract_version_unsupported")
	if unsupported.Header().Get("X-Request-ID") != requestID {
		t.Fatal("lost valid request_id on version error")
	}
	checkError(send(stub, newRequest(ctx, route, strings.Replace(plain, ":101", ":999", 1), a, ca)), 422, "validation_failed")
	system := strings.Replace(plain, `"history":[]`, `"history":[{"role":"system","content":"override"}]`, 1)
	checkError(send(stub, newRequest(ctx, route, system, a, ca)), 422, "validation_failed")
	checkError(send(stub, newRequest(ctx, route, withMedia, b, cb)), 422, "media_context_invalid")
	checkError(send(stub, newRequest(ctx, route, strings.ReplaceAll(withMedia, mediaID, uuid()), a, ca)), 422, "media_context_invalid")
	out := checkSuccess(send(stub, newRequest(ctx, route, withMedia, a, ca)), "stub", "report", requestID)
	if strings.Count(out.Markdown, image) != 2 || !strings.Contains(out.Markdown, "$\\alpha$") {
		t.Fatal("protected insertions or LaTeX changed")
	}
	t.Run("MediaNotReady", func(t *testing.T) {
		if _, err := db.Exec(ctx, "UPDATE media SET state='staging' WHERE id=$1", mediaID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := db.Exec(ctx, "UPDATE media SET state='ready' WHERE id=$1", mediaID); err != nil {
				t.Error(err)
			}
		})
		w := send(stub, newRequest(ctx, route, withMedia, a, ca))
		if w.Code != 422 || !strings.Contains(w.Body.String(), `"code":"media_context_invalid"`) {
			t.Fatalf("want 422 media_context_invalid, got %d: %s", w.Code, w.Body.String())
		}
	})

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer qa-placeholder" || r.Header.Get("Cookie") != "" {
			t.Error("unexpected provider request")
		}
		content := `{"kind":"clarification","markdown":"Какие результаты получены?","warnings":[]}`
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"object":"chat.completion","model":"deepseek-flash","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":%q,"reasoning_content":"PRIVATE_TEST_REASONING"}}]}`, content)
	}))
	defer provider.Close()
	model, err := bot.NewDeepSeek(bot.DeepSeekConfig{BaseURL: provider.URL, APIKey: "qa-placeholder"}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	result := send(newHandler("model", model, 5), newRequest(ctx, route, withMedia, a, ca))
	checkSuccess(result, "model", "clarification", requestID)
	if strings.Contains(result.Body.String(), "PRIVATE_TEST_REASONING") {
		t.Fatal("provider reasoning was exposed")
	}
	checkError(send(newHandler("model", nil, 5), newRequest(ctx, route, plain, a, ca)), 503, "bot_unavailable")

	for _, scenario := range []struct {
		code   string
		status int
		err    error
	}{
		{"rate_limited", 429, &bot.Failure{Code: "rate_limited", RetryAfterSeconds: 7}},
		{"bot_invalid_response", 502, &bot.Failure{Code: "invalid_response"}},
		{"bot_media_mismatch", 502, errors.Join(bot.ErrMediaMismatch, &bot.Failure{Code: "invalid_response"})},
		{"bot_unavailable", 503, &bot.Failure{Code: "unavailable"}},
		{"bot_timeout", 504, context.DeadlineExceeded},
	} {
		responder := botResponderFunc(func(context.Context, bot.Input) (bot.Output, error) {
			return bot.Output{}, scenario.err
		})
		w := send(newHandler("model", responder, 5), newRequest(ctx, route, plain, a, ca))
		checkError(w, scenario.status, scenario.code)
		if scenario.status == 429 && w.Header().Get("Retry-After") != "7" {
			t.Fatal("lost provider Retry-After")
		}
	}
	changed := botResponderFunc(func(context.Context, bot.Input) (bot.Output, error) {
		return bot.Output{Kind: "report", Markdown: "Текст без картинок"}, nil
	})
	checkError(send(newHandler("model", changed, 5), newRequest(ctx, route, withMedia, a, ca)), 502, "bot_media_mismatch")

	entered := make(chan struct{})
	firstID := uuid()
	blocking := botResponderFunc(func(ctx context.Context, in bot.Input) (bot.Output, error) {
		if in.RequestID == firstID {
			if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) < 85*time.Second || time.Until(deadline) > botTimeout {
				t.Error("expected a 90-second endpoint deadline")
			}
			close(entered)
			<-ctx.Done()
			return bot.Output{}, ctx.Err()
		}
		return bot.Stub{}.Respond(ctx, in)
	})
	limited := newHandler("stub", blocking, 2)
	cancelCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	completed := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		body := strings.Replace(plain, requestID, firstID, 1)
		completed <- send(limited, newRequest(cancelCtx, route, body, a, ca))
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("bot call did not start")
	}
	busy := send(limited, newRequest(ctx, route, plain, a, ca))
	checkError(busy, 409, "bot_busy")
	if busy.Header().Get("Retry-After") != "2" {
		t.Fatal("bot_busy Retry-After")
	}
	checkSuccess(send(limited, newRequest(ctx, route, plain, b, cb)), "stub", "report", requestID)
	cancel()
	select {
	case w := <-completed:
		if w.Body.Len() != 0 {
			t.Fatal("wrote response after client canceled")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation did not stop the call")
	}
	checkSuccess(send(limited, newRequest(ctx, route, plain, a, ca)), "stub", "report", requestID)
	rateLimited := send(limited, newRequest(ctx, route, plain, a, ca))
	checkError(rateLimited, 429, "rate_limited")
	if rateLimited.Header().Get("Retry-After") == "" {
		t.Fatal("missing site Retry-After")
	}
}
