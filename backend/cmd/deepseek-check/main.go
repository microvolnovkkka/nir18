// deepseek-check performs an explicit paid API check. go test never invokes it.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"nir18/backend/internal/bot"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	topic := flag.String("topic", "Статические и динамические жесты", "Report topic")
	message := flag.String("message", "Подготовь короткий теоретический обзор. Статический жест описывает положение кисти, динамический — движение во времени. Эксперименты не проводились, источники пока не подобраны.", "Author material")
	markdownFile := flag.String("markdown", "", "Optional UTF-8 current Markdown file")
	thinking := flag.Bool("thinking", false, "Enable thinking mode")
	flag.Parse()
	cfg, err := bot.DeepSeekConfigFromEnv()
	if err != nil {
		return err
	}
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "thinking" {
			cfg.Thinking = *thinking
		}
	})
	responder, err := bot.NewDeepSeek(cfg, nil)
	if err != nil {
		return err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return errors.New("cannot generate request ID")
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	in := bot.Input{RequestID: fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), Topic: bot.Topic{Title: *topic}, Message: *message}
	if *markdownFile != "" {
		f, e := os.Open(*markdownFile)
		if e != nil {
			return fmt.Errorf("cannot open Markdown file")
		}
		defer f.Close()
		data, e := io.ReadAll(io.LimitReader(f, bot.MaxMarkdownBytes+1))
		if e != nil || len(data) > bot.MaxMarkdownBytes {
			return fmt.Errorf("invalid or oversized Markdown file")
		}
		in.CurrentMarkdown = string(data)
	}
	in.ProtectedImages, err = bot.ProtectedImages(in.CurrentMarkdown)
	if err != nil {
		return fmt.Errorf("unsupported Markdown images or HTML")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	out, diag, err := responder.RespondMeasured(ctx, in)
	// Print only the validated result and safe counts, including on failure.
	result := struct {
		Response    any             `json:"response,omitempty"`
		Diagnostics bot.Diagnostics `json:"diagnostics"`
		Error       string          `json:"error,omitempty"`
	}{Diagnostics: diag}
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Response = struct {
			Kind     string   `json:"kind"`
			Markdown string   `json:"markdown"`
			Warnings []string `json:"warnings"`
		}{out.Kind, out.Markdown, out.Warnings}
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if e := encoder.Encode(result); e != nil {
		return e
	}
	if err != nil {
		return fmt.Errorf("API check failed; see safe diagnostics above")
	}
	return nil
}
