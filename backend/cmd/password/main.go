// password changes an existing team's account; it never creates users.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"golang.org/x/term"
	"io"
	"nir18/backend/internal/auth"
	"nir18/backend/internal/platform"
	"os"
	"strings"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	login := flag.String("login", "", "логин существующего участника")
	stdin := flag.Bool("stdin", false, "читать одну строку из stdin (для автоматизации)")
	flag.Parse()
	if *login == "" || flag.NArg() != 0 {
		return fmt.Errorf("укажите -login; пароль не передаётся аргументом")
	}
	var password []byte
	var err error
	if *stdin {
		password, err = io.ReadAll(io.LimitReader(os.Stdin, 515))
		password = []byte(strings.TrimSuffix(strings.TrimSuffix(string(password), "\n"), "\r"))
	} else {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return fmt.Errorf("нужен терминал или явный -stdin")
		}
		fmt.Fprint(os.Stderr, "Новый пароль: ")
		password, err = term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err == nil {
			fmt.Fprint(os.Stderr, "Повторите: ")
			var again []byte
			again, err = term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if string(password) != string(again) {
				return fmt.Errorf("пароли не совпадают")
			}
		}
	}
	if err != nil {
		return fmt.Errorf("не удалось прочитать пароль")
	}
	hash, err := auth.Hash(string(password))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := platform.OpenPool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	if err = tx.QueryRow(ctx, "UPDATE users SET password_hash=$1,is_active=true WHERE login=$2 RETURNING id::text", hash, strings.ToLower(strings.TrimSpace(*login))).Scan(&id); err != nil {
		return fmt.Errorf("существующий аккаунт не найден или БД недоступна")
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", id); err != nil {
		return fmt.Errorf("не удалось отозвать сессии")
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("не удалось сохранить пароль")
	}
	out := bufio.NewWriter(os.Stdout)
	fmt.Fprintln(out, "Пароль установлен; прежние сессии отозваны.")
	return out.Flush()
}
