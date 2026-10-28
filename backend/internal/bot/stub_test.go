package bot

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStubPreservesCurrentMarkdownAndImages(t *testing.T) {
	md := "Авторские правки\n![Схема](/media/30000000-0000-4000-8000-000000000001)"
	out, err := (Stub{}).Respond(context.Background(), Input{CurrentMarkdown: md})
	if err != nil || !strings.HasPrefix(out.Markdown, md) || out.Kind != "report" || len(out.Warnings) == 0 {
		t.Fatalf("incompatible stub result: %v", err)
	}
}
func TestStubCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, err := (Stub{Delay: time.Second}).Respond(ctx, Input{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
}
func TestStubTypedFailure(t *testing.T) {
	_, err := (Stub{FailureCode: "unavailable"}).Respond(context.Background(), Input{})
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != "unavailable" {
		t.Fatalf("wrong failure: %v", err)
	}
}
