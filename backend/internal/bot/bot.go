// Package bot defines the embedded-module boundary from contract 1.0-draft.
// No HTTP handler is enabled until authentication is implemented.
package bot

import "context"

const ContractVersion = "1.0-draft"

type Responder interface {
	Respond(context.Context, Input) (Output, error)
}
type Topic struct {
	SubtopicID, DirectionID            int16
	SubtopicName, DirectionName, Title string
}
type Message struct{ Role, Content string }
type Input struct {
	RequestID       string
	Topic           Topic
	Message         string
	History         []Message
	CurrentMarkdown string
	ProtectedImages []string
}
type Output struct {
	Kind, Markdown string
	Warnings       []string
}
type Failure struct {
	Code              string
	RetryAfterSeconds int
}

func (e *Failure) Error() string { return e.Code }
