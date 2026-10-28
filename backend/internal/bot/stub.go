package bot

import (
	"context"
	"time"
)

// Stub has no network dependencies. Delay and FailureCode are test controls.
type Stub struct {
	Delay       time.Duration
	FailureCode string
}

func (s Stub) Respond(ctx context.Context, in Input) (Output, error) {
	if err := ctx.Err(); err != nil {
		return Output{}, err
	}
	timer := time.NewTimer(s.Delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return Output{}, ctx.Err()
	case <-timer.C:
	}
	if err := ctx.Err(); err != nil {
		return Output{}, err
	}
	if s.FailureCode != "" {
		return Output{}, &Failure{Code: s.FailureCode, RetryAfterSeconds: 2}
	}
	body := in.CurrentMarkdown
	if body == "" {
		body = "## Тестовый ответ\n\nЭто демонстрационная заглушка. Реальная модель не подключена.\n\nПеред публикацией автор должен подготовить и проверить содержательный отчёт."
	}
	body += "\n\n_Тестовый режим: генерация не выполнялась._"
	return Output{Kind: "report", Markdown: body, Warnings: []string{"Тестовый режим: реальная генерация не подключена."}}, nil
}
