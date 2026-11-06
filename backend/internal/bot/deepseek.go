package bot

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

//go:embed prompt.txt
var systemPrompt string

const PromptVersion = "nir18-2026-11-06.1"
const MaxMarkdownBytes = 800000
const maxProviderBytes = 8 << 20
const defaultDeepSeekMaxTokens = 1 << 15

var ErrInvalidInput = errors.New("invalid bot input")

type DeepSeekConfig struct {
	APIKey    string
	BaseURL   string
	Model     string
	Thinking  bool
	MaxTokens int
}

// DeepSeekConfigFromEnv reads secrets only on the server. It never loads .env implicitly.
func DeepSeekConfigFromEnv() (DeepSeekConfig, error) {
	cfg := DeepSeekConfig{APIKey: strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")), BaseURL: strings.TrimSpace(os.Getenv("DEEPSEEK_BASE_URL")), Model: strings.TrimSpace(os.Getenv("DEEPSEEK_MODEL")), MaxTokens: defaultDeepSeekMaxTokens}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.deepseek.com"
	}
	if cfg.Model == "" {
		cfg.Model = "deepseek-flash"
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DEEPSEEK_THINKING"))) {
	case "", "false", "disabled", "0":
	case "true", "enabled", "1":
		cfg.Thinking = true
	default:
		return cfg, errors.New("DEEPSEEK_THINKING must be true or false")
	}
	if s := os.Getenv("DEEPSEEK_MAX_TOKENS"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 256 || n > 32768 {
			return cfg, errors.New("DEEPSEEK_MAX_TOKENS must be between 256 and 32768")
		}
		cfg.MaxTokens = n
	}
	return cfg, nil
}

// DeepSeek is immutable after construction and safe for concurrent use.
type DeepSeek struct {
	config   DeepSeekConfig
	endpoint string
	client   *http.Client
}

var _ Responder = (*DeepSeek)(nil)

func NewDeepSeek(cfg DeepSeekConfig, client *http.Client) (*DeepSeek, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("DEEPSEEK_API_KEY is not configured")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.deepseek.com"
	}
	if cfg.Model == "" {
		cfg.Model = "deepseek-flash"
	}
	if cfg.MaxTokens == 0 {
		cfg.MaxTokens = defaultDeepSeekMaxTokens
	}
	if len(cfg.Model) > 200 || strings.ContainsAny(cfg.APIKey, "\r\n") || cfg.MaxTokens < 256 || cfg.MaxTokens > 32768 {
		return nil, errors.New("invalid DeepSeek configuration")
	}
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid DEEPSEEK_BASE_URL")
	}
	// HTTP is accepted only for loopback httptest servers; remote credentials require HTTPS.
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, errors.New("DEEPSEEK_BASE_URL must use HTTPS")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/chat/completions"
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	owned := *client
	owned.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("provider redirects are disabled") }
	return &DeepSeek{config: cfg, endpoint: u.String(), client: &owned}, nil
}

// Diagnostics contains counts and timings only, never prompts, secrets or reasoning text.
// It belongs to the local test harness, not to the production HTTP contract.
type Diagnostics struct {
	Model               string      `json:"model"`
	PromptVersion       string      `json:"prompt_version"`
	Thinking            bool        `json:"thinking"`
	ElapsedMS           int64       `json:"elapsed_ms"`
	ProviderHTTP        int         `json:"provider_http"`
	FinishReason        string      `json:"finish_reason,omitempty"`
	ReasoningPresent    bool        `json:"reasoning_present"`
	ReasoningCharacters int         `json:"reasoning_characters"`
	ContentCharacters   int         `json:"content_characters"`
	Usage               *TokenUsage `json:"usage,omitempty"`
}
type TokenUsage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
}

func (d *DeepSeek) Respond(ctx context.Context, in Input) (Output, error) {
	out, _, err := d.RespondMeasured(ctx, in)
	return out, err
}

type providerMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type providerRequest struct {
	Model    string            `json:"model"`
	Messages []providerMessage `json:"messages"`
	Stream   bool              `json:"stream"`
	Thinking struct {
		Type string `json:"type"`
	} `json:"thinking"`
	ResponseFormat struct {
		Type string `json:"type"`
	} `json:"response_format"`
	MaxTokens int `json:"max_tokens"`
}
type modelOutput struct {
	Kind     string   `json:"kind"`
	Markdown string   `json:"markdown"`
	Warnings []string `json:"warnings"`
}

func (d *DeepSeek) RespondMeasured(ctx context.Context, in Input) (out Output, diag Diagnostics, err error) {
	start := time.Now()
	diag = Diagnostics{Model: d.config.Model, Thinking: d.config.Thinking, PromptVersion: PromptVersion}
	defer func() { diag.ElapsedMS = time.Since(start).Milliseconds() }()
	if err = ValidateInput(in); err != nil {
		return
	}
	// The caller may impose a shorter deadline. Never extend it or retry implicitly.
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err = ctx.Err(); err != nil {
		return
	}
	data, marshalErr := json.Marshal(struct {
		Topic           Topic    `json:"topic"`
		Message         string   `json:"message"`
		CurrentMarkdown string   `json:"current_markdown"`
		ProtectedImages []string `json:"protected_images"`
	}{in.Topic, in.Message, in.CurrentMarkdown, in.ProtectedImages})
	if marshalErr != nil {
		err = ErrInvalidInput
		return
	}
	payload := providerRequest{Model: d.config.Model, MaxTokens: d.config.MaxTokens, Messages: []providerMessage{{Role: "system", Content: systemPrompt}}}
	for _, item := range in.History {
		payload.Messages = append(payload.Messages, providerMessage{item.Role, item.Content})
	}
	payload.Messages = append(payload.Messages, providerMessage{Role: "user", Content: string(data)})
	payload.Thinking.Type = "disabled"
	if d.config.Thinking {
		payload.Thinking.Type = "enabled"
	}
	payload.ResponseFormat.Type = "json_object"
	body, _ := json.Marshal(payload)
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if reqErr != nil {
		err = &Failure{Code: "unavailable"}
		return
	}
	req.Header.Set("Authorization", "Bearer "+d.config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, sendErr := d.client.Do(req)
	if sendErr != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		} else {
			var timeout net.Error
			if errors.As(sendErr, &timeout) && timeout.Timeout() {
				err = context.DeadlineExceeded
			} else {
				err = &Failure{Code: "unavailable"}
			}
		}
		return
	}
	defer res.Body.Close()
	diag.ProviderHTTP = res.StatusCode
	if res.StatusCode != http.StatusOK {
		if res.StatusCode == http.StatusTooManyRequests {
			err = &Failure{Code: "rate_limited", RetryAfterSeconds: retryAfter(res.Header.Get("Retry-After"))}
		} else {
			err = &Failure{Code: "unavailable"}
		}
		return
	}
	raw, readErr := io.ReadAll(io.LimitReader(res.Body, maxProviderBytes+1))
	if readErr != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		} else {
			err = &Failure{Code: "unavailable"}
		}
		return
	}
	invalid := func() { err = &Failure{Code: "invalid_response"} }
	if len(raw) > maxProviderBytes || !utf8.Valid(raw) {
		invalid()
		return
	}
	var response struct {
		Object  string          `json:"object"`
		Model   string          `json:"model"`
		Error   json.RawMessage `json:"error"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Role      string  `json:"role"`
				Content   *string `json:"content"`
				Reasoning *string `json:"reasoning_content"`
			} `json:"message"`
		} `json:"choices"`
		Usage *TokenUsage `json:"usage"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Object != "chat.completion" || len(response.Choices) != 1 || (len(response.Error) > 0 && string(response.Error) != "null") {
		invalid()
		return
	}
	choice := response.Choices[0]
	if response.Model == "" || len(response.Model) > 200 {
		invalid()
		return
	}
	diag.Model = strings.ReplaceAll(response.Model, d.config.APIKey, "[redacted]")
	switch choice.FinishReason {
	case "stop", "length", "content_filter", "tool_calls", "insufficient_system_resource":
		diag.FinishReason = choice.FinishReason
	default:
		diag.FinishReason = "unexpected"
	}
	diag.Usage = response.Usage
	if choice.Message.Reasoning != nil {
		diag.ReasoningPresent = true
		diag.ReasoningCharacters = utf8.RuneCountInString(*choice.Message.Reasoning)
	}
	if choice.Message.Content != nil {
		diag.ContentCharacters = utf8.RuneCountInString(*choice.Message.Content)
	}
	if choice.Message.Role != "assistant" || choice.FinishReason != "stop" || choice.Message.Content == nil {
		invalid()
		return
	}
	content := strings.TrimSpace(*choice.Message.Content)
	if content == "" || len(content) > 2<<20 {
		invalid()
		return
	}
	var result modelOutput
	if decodeModelOutput([]byte(content), &result) != nil {
		invalid()
		return
	}
	if result.Kind != "report" && result.Kind != "clarification" {
		invalid()
		return
	}
	if !validText(result.Markdown, 200000, MaxMarkdownBytes) || result.Warnings == nil || len(result.Warnings) > 10 {
		invalid()
		return
	}
	for _, warning := range result.Warnings {
		if !validText(warning, 500, 2000) {
			invalid()
			return
		}
	}
	if strings.Contains(result.Markdown, d.config.APIKey) {
		invalid()
		return
	}
	for _, warning := range result.Warnings {
		if strings.Contains(warning, d.config.APIKey) {
			invalid()
			return
		}
	}
	if mediaErr := ValidateOutputImages(result.Kind, result.Markdown, in.ProtectedImages); mediaErr != nil {
		err = mediaErr
		return
	}
	out = Output{Kind: result.Kind, Markdown: result.Markdown, Warnings: result.Warnings}
	return
}

// Reject missing/unknown/duplicate keys and trailing JSON in the model's own object.
func decodeModelOutput(raw []byte, target *modelOutput) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return errors.New("expected object")
	}
	fields := map[string]json.RawMessage{}
	for dec.More() {
		keyToken, e := dec.Token()
		if e != nil {
			return e
		}
		key, ok := keyToken.(string)
		if !ok {
			return errors.New("invalid key")
		}
		if key != "kind" && key != "markdown" && key != "warnings" {
			return errors.New("unknown key")
		}
		if _, exists := fields[key]; exists {
			return errors.New("duplicate key")
		}
		var value json.RawMessage
		if e = dec.Decode(&value); e != nil {
			return e
		}
		fields[key] = value
	}
	if _, err = dec.Token(); err != nil {
		return err
	}
	var extra any
	if dec.Decode(&extra) != io.EOF || len(fields) != 3 {
		return errors.New("incomplete or trailing JSON")
	}
	for _, v := range fields {
		if string(v) == "null" {
			return errors.New("null field")
		}
	}
	return json.Unmarshal(raw, target)
}

func validText(s string, runes, size int) bool {
	return utf8.ValidString(s) && strings.TrimSpace(s) != "" && len(s) <= size && utf8.RuneCountInString(s) <= runes
}

func ValidateInput(in Input) error {
	if !validText(in.Topic.Title, 200, 800) || !validText(in.Message, 20000, 80000) || len(in.History) > 20 || len(in.CurrentMarkdown) > MaxMarkdownBytes || utf8.RuneCountInString(in.CurrentMarkdown) > 200000 || !utf8.ValidString(in.CurrentMarkdown) {
		return ErrInvalidInput
	}
	total := 0
	for _, m := range in.History {
		if (m.Role != "user" && m.Role != "assistant") || !validText(m.Content, 20000, 80000) {
			return ErrInvalidInput
		}
		total += utf8.RuneCountInString(m.Content)
	}
	if total > 80000 {
		return ErrInvalidInput
	}
	images, err := ProtectedImages(in.CurrentMarkdown)
	if err != nil || !sameImages(images, in.ProtectedImages) {
		return ErrInvalidInput
	}
	return nil
}

func retryAfter(value string) int {
	n, err := strconv.Atoi(value)
	if err != nil {
		if when, e := http.ParseTime(value); e == nil {
			n = int(time.Until(when).Seconds())
		}
	}
	if n < 1 {
		n = 2
	}
	if n > 3600 {
		n = 3600
	}
	return n
}
