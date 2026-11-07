package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"nir18/backend/internal/bot"
	"nir18/backend/internal/botplayground"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	addr := flag.String("addr", "127.0.0.1:8090", "Loopback address of the local test page")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil {
		return errors.New("invalid local address")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("bot-playground must bind an explicit loopback IP")
	}
	cfg, err := bot.DeepSeekConfigFromEnv()
	if err != nil {
		return err
	}
	var fast, thinking botplayground.MeasuredResponder
	if cfg.APIKey != "" {
		cfg.Thinking = false
		fast, err = bot.NewDeepSeek(cfg, nil)
		if err != nil {
			return err
		}
		cfg.Thinking = true
		thinking, err = bot.NewDeepSeek(cfg, nil)
		if err != nil {
			return err
		}
	}
	handler, err := botplayground.NewHandler(fast, thinking, cfg.Model)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return errors.New("local port is unavailable; stop the previous playground or choose another port")
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 110 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	fmt.Printf("DeepSeek local playground: http://%s\n", listener.Addr())
	if cfg.APIKey == "" {
		fmt.Println("API key not configured. Restart with DEEPSEEK_API_KEY to generate articles.")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("local server stopped")
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
