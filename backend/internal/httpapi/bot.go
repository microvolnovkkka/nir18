package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"nir18/backend/internal/bot"
)

const botTimeout = 90 * time.Second

type botResponse struct {
	Version   string   `json:"contract_version"`
	RequestID string   `json:"request_id"`
	Mode      string   `json:"mode"`
	Kind      string   `json:"kind"`
	Markdown  string   `json:"markdown"`
	Warnings  []string `json:"warnings"`
}

// The shared JSON decoder checks syntax and duplicate keys. Binding by exact
// names here also rejects aliases that encoding/json would match by case.
type botFields map[string]json.RawMessage

func (body botFields) bind(fields map[string]any) error {
	if len(body) != len(fields) {
		return fail(http.StatusBadRequest, "bad_request")
	}
	for name, target := range fields {
		if err := json.Unmarshal(body[name], target); err != nil {
			return fail(http.StatusBadRequest, "bad_request")
		}
	}
	return nil
}

func parseBotInput(w http.ResponseWriter, r *http.Request) (bot.Input, error) {
	var input bot.Input
	var body botFields
	if err := decode(w, r, &body, 2<<20); err != nil {
		return input, err
	}
	var requestID string
	if json.Unmarshal(body["request_id"], &requestID) == nil && validID(requestID) == nil {
		w.Header().Set("X-Request-ID", requestID)
	}
	var version string
	var topic botFields
	var history []botFields
	if err := body.bind(map[string]any{
		"contract_version": &version,
		"request_id":       &input.RequestID,
		"topic":            &topic,
		"message":          &input.Message,
		"history":          &history,
		"current_markdown": &input.CurrentMarkdown,
	}); err != nil {
		return input, err
	}
	if err := validID(input.RequestID); err != nil {
		return input, err
	}
	if version != bot.ContractVersion {
		return input, fail(http.StatusUnprocessableEntity, "contract_version_unsupported")
	}
	if err := topic.bind(map[string]any{
		"subtopic_id": &input.Topic.SubtopicID,
		"title":       &input.Topic.Title,
	}); err != nil {
		return input, err
	}
	if len(history) > 20 {
		return input, fail(http.StatusUnprocessableEntity, "validation_failed")
	}
	input.History = make([]bot.Message, len(history))
	for i, message := range history {
		if err := message.bind(map[string]any{
			"role":    &input.History[i].Role,
			"content": &input.History[i].Content,
		}); err != nil {
			return input, err
		}
	}
	if input.Topic.SubtopicID <= 0 || bot.ValidateInputText(input) != nil {
		return input, fail(http.StatusUnprocessableEntity, "validation_failed")
	}
	return input, nil
}

type botUser struct {
	active   bool
	attempts []time.Time
}

func (s *Server) reserveBot(w http.ResponseWriter, userID string) (func(), error) {
	s.botMu.Lock()
	defer s.botMu.Unlock()

	user := s.botUsers[userID]
	if user == nil {
		user = &botUser{}
		s.botUsers[userID] = user
	}
	if user.active {
		w.Header().Set("Retry-After", "2")
		return nil, fail(http.StatusConflict, "bot_busy")
	}
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	first := 0
	for first < len(user.attempts) && !user.attempts[first].After(cutoff) {
		first++
	}
	user.attempts = user.attempts[first:]
	if len(user.attempts) >= s.cfg.BotRequestsPerMinute {
		wait := user.attempts[0].Sub(cutoff)
		w.Header().Set("Retry-After", strconv.Itoa(int((wait+time.Second-1)/time.Second)))
		return nil, fail(http.StatusTooManyRequests, "rate_limited")
	}
	user.attempts = append(user.attempts, now)
	user.active = true
	return func() {
		s.botMu.Lock()
		user.active = false
		s.botMu.Unlock()
	}, nil
}

func (s *Server) botRespond(w http.ResponseWriter, r *http.Request) error {
	ctx, cancel := context.WithTimeout(r.Context(), botTimeout)
	defer cancel()
	err := s.generateBotResponse(w, r.WithContext(ctx))
	if err == nil || errors.Is(r.Context().Err(), context.Canceled) {
		return nil
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return fail(http.StatusGatewayTimeout, "bot_timeout")
	}
	return err
}

func (s *Server) generateBotResponse(w http.ResponseWriter, r *http.Request) error {
	a, err := s.authorize(r)
	if err != nil {
		return err
	}
	if err = query(r); err != nil {
		return err
	}
	input, err := parseBotInput(w, r)
	if err != nil {
		return err
	}
	release, err := s.reserveBot(w, a.User.ID)
	if err != nil {
		return err
	}
	defer release()

	ctx := r.Context()
	err = s.db.QueryRow(ctx, `
		SELECT d.id, d.name, st.name
		FROM subtopics st JOIN directions d ON d.id = st.direction_id
		WHERE st.id = $1`, input.Topic.SubtopicID).
		Scan(&input.Topic.DirectionID, &input.Topic.DirectionName, &input.Topic.SubtopicName)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(http.StatusUnprocessableEntity, "validation_failed")
	}
	if err != nil {
		return err
	}
	input.ProtectedImages, err = bot.ProtectedImages(input.CurrentMarkdown)
	if err != nil {
		return fail(http.StatusUnprocessableEntity, "media_context_invalid")
	}
	if err = s.checkBotMedia(ctx, a.User.ID, input.ProtectedImages); err != nil {
		return err
	}
	if s.cfg.BotResponder == nil {
		return fail(http.StatusServiceUnavailable, "bot_unavailable")
	}
	out, err := s.cfg.BotResponder.Respond(ctx, input)
	if err != nil {
		return botHTTPError(w, err)
	}
	if err = bot.ValidateOutput(out, input.ProtectedImages); err != nil {
		return botHTTPError(w, err)
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if out.Warnings == nil {
		out.Warnings = []string{}
	}
	respond(w, http.StatusOK, botResponse{
		Version:   bot.ContractVersion,
		RequestID: input.RequestID,
		Mode:      s.cfg.BotMode,
		Kind:      out.Kind,
		Markdown:  out.Markdown,
		Warnings:  out.Warnings,
	})
	return nil
}

func (s *Server) checkBotMedia(ctx context.Context, ownerID string, images []string) error {
	if len(images) == 0 {
		return nil
	}
	seen := make(map[string]bool)
	var ids []string
	for _, image := range images {
		// ProtectedImages guarantees each exact insertion ends with ](/media/<uuid>).
		const destination = "](/media/"
		start := strings.LastIndex(image, destination) + len(destination)
		id := strings.ToLower(image[start : len(image)-1])
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	var ready int
	err := s.db.QueryRow(ctx, `
		SELECT count(*)
		FROM media m
		WHERE m.id = ANY($1::text[]::uuid[]) AND m.owner_id = $2 AND m.state = 'ready'
			AND (m.lease_until > now() OR EXISTS (
				SELECT 1 FROM publication_media WHERE media_id = m.id
			))`, ids, ownerID).Scan(&ready)
	if err != nil {
		return err
	}
	if ready != len(ids) {
		return fail(http.StatusUnprocessableEntity, "media_context_invalid")
	}
	return nil
}

func botHTTPError(w http.ResponseWriter, err error) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return err
	case errors.Is(err, bot.ErrMediaMismatch):
		return fail(http.StatusBadGateway, "bot_media_mismatch")
	}
	var failure *bot.Failure
	if errors.As(err, &failure) {
		switch failure.Code {
		case "rate_limited":
			retryAfter := failure.RetryAfterSeconds
			if retryAfter <= 0 {
				retryAfter = 2
			}
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			return fail(http.StatusTooManyRequests, "rate_limited")
		case "invalid_response":
			return fail(http.StatusBadGateway, "bot_invalid_response")
		}
	}
	return fail(http.StatusServiceUnavailable, "bot_unavailable")
}
