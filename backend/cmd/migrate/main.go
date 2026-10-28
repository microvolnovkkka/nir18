package main

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"nir18/backend/internal/platform"
	"nir18/backend/migrations"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	url, err := platform.DatabaseURL()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return fmt.Errorf("cannot connect to database for migrations")
	}
	defer conn.Close(context.Background())
	if err = migrations.Apply(ctx, conn); err != nil {
		return err
	}
	fmt.Println("Migrations applied; schema version", migrations.LatestVersion)
	return nil
}
