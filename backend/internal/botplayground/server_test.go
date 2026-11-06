package botplayground

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"nir18/backend/internal/bot"
	"strings"
	"testing"
	"time"
)

type fakeResponder func(context.Context, bot.Input) (bot.Output, bot.Diagnostics, error)

func (f fakeResponder) RespondMeasured(ctx context.Context, in bot.Input) (bot.Output, bot.Diagnostics, error) {
	return f(ctx, in)
}

func TestPlaygroundBusyAndCancellation(t *testing.T) {
	entered := make(chan struct{})
	fake := fakeResponder(func(ctx context.Context, in bot.Input) (bot.Output, bot.Diagnostics, error) {
		close(entered)
		<-ctx.Done()
		return bot.Output{}, bot.Diagnostics{}, ctx.Err()
	})
	h, _ := NewHandler(fake, fake, "deepseek-flash")
	token := localToken(t, h)
	first := localRequest("POST", "/local/generate", validRequest)
	first.Header.Set("X-Local-Token", token)
	ctx, cancel := context.WithCancel(first.Context())
	defer cancel()
	first = first.WithContext(ctx)
	done := make(chan struct{})
	go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), first) }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("request not started")
	}
	second := localRequest("POST", "/local/generate", validRequest)
	second.Header.Set("X-Local-Token", token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, second)
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("request was not canceled")
	}
}
func localRequest(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:8090"+path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:50000"
	r.Header.Set("Origin", "http://127.0.0.1:8090")
	r.Header.Set("Content-Type", "application/json")
	return r
}
func localToken(t *testing.T, h http.Handler) string {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, localRequest("GET", "/local/status", ""))
	var v struct {
		Token string `json:"local_token"`
	}
	if json.Unmarshal(w.Body.Bytes(), &v) != nil || v.Token == "" {
		t.Fatal(w.Body.String())
	}
	return v.Token
}

const validRequest = `{"request_id":"40000000-0000-4000-8000-000000000001","title":"Жесты","message":"Подготовь обзор","history":[],"current_markdown":"","thinking":false}`

func TestPlaygroundMatchesContractWithoutReasoningText(t *testing.T) {
	fake := fakeResponder(func(ctx context.Context, in bot.Input) (bot.Output, bot.Diagnostics, error) {
		if in.Topic.Title != "Жесты" {
			t.Error("wrong input")
		}
		return bot.Output{Kind: "report", Markdown: "# Обзор", Warnings: []string{}}, bot.Diagnostics{Model: "deepseek-flash", ReasoningPresent: true, ReasoningCharacters: 20}, nil
	})
	h, err := NewHandler(fake, fake, "deepseek-flash")
	if err != nil {
		t.Fatal(err)
	}
	token := localToken(t, h)
	r := localRequest("POST", "/local/generate", validRequest)
	r.Header.Set("X-Local-Token", token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct {
		Response response `json:"response"`
	}
	if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Response.ContractVersion != bot.ContractVersion || result.Response.Mode != "model" || result.Response.RequestID != "40000000-0000-4000-8000-000000000001" {
		t.Fatal(w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte(`"reasoning_content"`)) {
		t.Fatal("reasoning payload exposed")
	}
}

func TestPlaygroundLocalProtectionAndValidation(t *testing.T) {
	h, _ := NewHandler(nil, nil, "deepseek-flash")
	token := localToken(t, h)
	for _, tt := range []struct {
		name, body, origin, auth, host string
		status                         int
	}{
		{"missing token", validRequest, "http://127.0.0.1:8090", "", "", 403},
		{"foreign origin", validRequest, "https://example.com", token, "", 403},
		{"rebinding host", validRequest, "http://127.0.0.1:8090", token, "attacker.example:8090", 403},
		{"unknown field", strings.TrimSuffix(validRequest, "}") + `,"author":"x"}`, "http://127.0.0.1:8090", token, "", 400},
		{"bad role", strings.Replace(validRequest, `"history":[]`, `"history":[{"role":"system","content":"x"}]`, 1), "http://127.0.0.1:8090", token, "", 422},
		{"unconfigured", validRequest, "http://127.0.0.1:8090", token, "", 503},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := localRequest("POST", "/local/generate", tt.body)
			r.Header.Set("Origin", tt.origin)
			r.Header.Set("X-Local-Token", tt.auth)
			if tt.host != "" {
				r.Host = tt.host
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tt.status {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	r := localRequest("GET", "/", "")
	r.RemoteAddr = "192.0.2.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("nonlocal remote accepted")
	}
}

func TestPlaygroundMapsFailuresAndRateLimit(t *testing.T) {
	for _, tt := range []struct {
		err    error
		status int
		code   string
	}{
		{context.DeadlineExceeded, 504, "bot_timeout"}, {&bot.Failure{Code: "unavailable"}, 503, "bot_unavailable"}, {&bot.Failure{Code: "rate_limited", RetryAfterSeconds: 10}, 429, "rate_limited"}, {errors.Join(bot.ErrMediaMismatch, &bot.Failure{Code: "invalid_response"}), 502, "bot_media_mismatch"},
	} {
		fake := fakeResponder(func(context.Context, bot.Input) (bot.Output, bot.Diagnostics, error) {
			return bot.Output{}, bot.Diagnostics{}, tt.err
		})
		h, _ := NewHandler(fake, fake, "deepseek-flash")
		r := localRequest("POST", "/local/generate", validRequest)
		r.Header.Set("X-Local-Token", localToken(t, h))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tt.status || !strings.Contains(w.Body.String(), tt.code) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	fake := fakeResponder(func(context.Context, bot.Input) (bot.Output, bot.Diagnostics, error) {
		return bot.Output{Kind: "clarification", Markdown: "Какие данные?", Warnings: []string{}}, bot.Diagnostics{}, nil
	})
	h, _ := NewHandler(fake, fake, "deepseek-flash")
	token := localToken(t, h)
	for i := 0; i < 6; i++ {
		r := localRequest("POST", "/local/generate", validRequest)
		r.Header.Set("X-Local-Token", token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		expected := 200
		if i == 5 {
			expected = 429
		}
		if w.Code != expected {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
