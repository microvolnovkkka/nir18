package httpapi

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"nir18/backend/migrations"
	"time"
)

func Router(pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		var count, version int
		err := pool.Ping(ctx)
		if err == nil {
			err = pool.QueryRow(ctx, "SELECT count(*), COALESCE(max(version),0) FROM schema_migrations").Scan(&count, &version)
		}
		if err != nil || version != migrations.LatestVersion || count != migrations.LatestVersion {
			respond(w, 503, map[string]string{"status": "not_ready"})
			return
		}
		respond(w, 200, map[string]string{"status": "ready", "database": "ok", "schema": "ok"})
	})
	return mux
}
func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
