package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"nir18/backend/internal/httpapi"
	"nir18/backend/internal/platform"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := platform.OpenPool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	app, err := httpapi.New(pool, httpapi.Config{Origin: os.Getenv("APP_ORIGIN"), MediaDir: os.Getenv("MEDIA_DIR"), Secure: os.Getenv("COOKIE_SECURE") == "true", TrustProxy: os.Getenv("TRUST_PROXY") == "true"})
	if err != nil {
		return err
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
				if err := app.Cleanup(cleanCtx); err != nil {
					slog.Error("media cleanup failed")
				}
				cancel()
			}
		}
	}()
	srv := &http.Server{Addr: addr, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 110 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	errs := make(chan error, 1)
	go func() { slog.Info("API listening", "addr", addr); errs <- srv.ListenAndServe() }()
	select {
	case err = <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err = srv.Shutdown(shutdown); err != nil {
			_ = srv.Close()
			return err
		}
	}
	return nil
}
