// Package botplayground is an isolated loopback-only developer harness.
// It does not register routes on the production site or replace its authentication.
package botplayground

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"nir18/backend/internal/bot"
	"regexp"
	"strconv"
	"sync"
	"time"
)

//go:embed web/*
var assets embed.FS

type MeasuredResponder interface {
	RespondMeasured(context.Context, bot.Input) (bot.Output, bot.Diagnostics, error)
}
type Handler struct {
	fast, thinking MeasuredResponder
	model, token   string
	busy           chan struct{}
	mu             sync.Mutex
	attempts       []time.Time
}

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func NewHandler(fast, thinking MeasuredResponder, model string) (http.Handler, error) {
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, errors.New("cannot initialize local request protection")
	}
	h := &Handler{fast: fast, thinking: thinking, model: model, token: hex.EncodeToString(nonce[:]), busy: make(chan struct{}, 1)}
	web, _ := fs.Sub(assets, "web")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		data, _ := assets.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(web))))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ready"}) })
	mux.HandleFunc("GET /local/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"configured": h.fast != nil && h.thinking != nil, "model": h.model, "prompt_version": bot.PromptVersion, "contract_version": bot.ContractVersion, "local_token": h.token})
	})
	mux.HandleFunc("POST /local/generate", h.generate)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		if !isLoopbackRequest(r) {
			writeError(w, 403, "local_only", "Стенд доступен только через localhost.", "", nil)
			return
		}
		mux.ServeHTTP(w, r)
	}), nil
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return false
	}
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	remoteIP := net.ParseIP(remote)
	return remoteIP != nil && remoteIP.IsLoopback()
}

type request struct {
	RequestID string `json:"request_id"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	History   []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"history"`
	CurrentMarkdown string `json:"current_markdown"`
	Thinking        bool   `json:"thinking"`
}
type response struct {
	ContractVersion string   `json:"contract_version"`
	RequestID       string   `json:"request_id"`
	Mode            string   `json:"mode"`
	Kind            string   `json:"kind"`
	Markdown        string   `json:"markdown"`
	Warnings        []string `json:"warnings"`
}

func (h *Handler) generate(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "http://"+r.Host || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Local-Token")), []byte(h.token)) != 1 {
		writeError(w, 403, "origin_invalid", "Обновите страницу и отправьте запрос из локального стенда.", "", nil)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, 415, "json_required", "Ожидается application/json.", "", nil)
		return
	}
	var in request
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&in)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, 413, "body_too_large", "Размер запроса превышает 2 МиБ.", "", nil)
		} else {
			writeError(w, 400, "invalid_json", "Некорректный JSON запроса.", "", nil)
		}
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		writeError(w, 400, "invalid_json", "Ожидается один JSON-объект.", "", nil)
		return
	}
	if !uuid.MatchString(in.RequestID) {
		writeError(w, 422, "invalid_request_id", "Некорректный идентификатор запроса.", "", nil)
		return
	}
	images, err := bot.ProtectedImages(in.CurrentMarkdown)
	if err != nil {
		writeError(w, 422, "media_context_invalid", "Допустимы inline-вставки ![описание](/media/UUID). HTML и внешние изображения не поддерживаются.", in.RequestID, nil)
		return
	}
	input := bot.Input{RequestID: in.RequestID, Topic: bot.Topic{Title: in.Title}, Message: in.Message, CurrentMarkdown: in.CurrentMarkdown, ProtectedImages: images}
	for _, m := range in.History {
		input.History = append(input.History, bot.Message{Role: m.Role, Content: m.Content})
	}
	if bot.ValidateInput(input) != nil {
		writeError(w, 422, "invalid_input", "Проверьте тему, материал, роли и ограничения длины истории/редактора.", in.RequestID, nil)
		return
	}
	responder := h.fast
	if in.Thinking {
		responder = h.thinking
	}
	if responder == nil {
		writeError(w, 503, "bot_unavailable", "Ключ не настроен. Остановите стенд и запустите START-DEEPSEEK.cmd, затем вставьте ключ в окне запуска.", in.RequestID, nil)
		return
	}
	select {
	case h.busy <- struct{}{}:
		defer func() { <-h.busy }()
	default:
		w.Header().Set("Retry-After", "2")
		writeError(w, 409, "bot_busy", "Дождитесь завершения текущего запроса или отмените его.", in.RequestID, nil)
		return
	}
	if !h.allowAttempt() {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "rate_limited", "Не более 5 запросов в минуту. Подождите перед новой попыткой.", in.RequestID, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	out, diag, err := responder.RespondMeasured(ctx, input)
	if err != nil {
		status, code, message := 502, "bot_invalid_response", "Модель вернула незавершённый или некорректный ответ. Материал сохранён в форме; повторите запрос явно."
		var failure *bot.Failure
		switch {
		case errors.Is(err, context.Canceled):
			return
		case errors.Is(err, context.DeadlineExceeded):
			status, code, message = 504, "bot_timeout", "Ответ не получен за отведённое время. Можно повторить запрос."
		case errors.Is(err, bot.ErrMediaMismatch):
			code, message = "bot_media_mismatch", "Ответ изменил набор изображений или содержит неподдерживаемую разметку. Результат заблокирован."
		case errors.As(err, &failure):
			switch failure.Code {
			case "unavailable":
				status, code, message = 503, "bot_unavailable", "DeepSeek недоступен. Проверьте ключ, баланс API и соединение в окне запуска."
			case "rate_limited":
				status, code, message = 429, "rate_limited", "Поставщик ограничил запросы. Подождите и повторите вручную."
				w.Header().Set("Retry-After", strconv.Itoa(failure.RetryAfterSeconds))
			}
		}
		writeError(w, status, code, message, in.RequestID, &diag)
		return
	}
	writeJSON(w, 200, map[string]any{"response": response{bot.ContractVersion, in.RequestID, "model", out.Kind, out.Markdown, out.Warnings}, "diagnostics": diag})
}

func (h *Handler) allowAttempt() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	kept := h.attempts[:0]
	for _, t := range h.attempts {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	h.attempts = kept
	if len(kept) >= 5 {
		return false
	}
	h.attempts = append(h.attempts, now)
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message, id string, diag *bot.Diagnostics) {
	if !uuid.MatchString(id) {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err == nil {
			raw[6] = (raw[6] & 15) | 64
			raw[8] = (raw[8] & 63) | 128
			s := hex.EncodeToString(raw[:])
			id = s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
		}
	}
	value := map[string]any{"error": map[string]any{"code": code, "message": message, "fields": map[string]string{}}, "request_id": id}
	if diag != nil {
		value["diagnostics"] = diag
	}
	writeJSON(w, status, value)
}
