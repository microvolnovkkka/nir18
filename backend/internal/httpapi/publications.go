package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

func number(v string, max int) (int, error) {
	n, e := strconv.Atoi(v)
	if e != nil || n < 1 || n > max {
		return 0, fail(400, "bad_request")
	}
	return n, nil
}
func (s *Server) catalog(w http.ResponseWriter, r *http.Request) error {
	allowed := []string{}
	if r.URL.Path == "/api/subtopics" {
		allowed = append(allowed, "direction_id")
	}
	if e := query(r, allowed...); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	sql := "SELECT id,name,position FROM directions ORDER BY position"
	args := []any{}
	if r.URL.Path == "/api/authors" {
		sql = "SELECT id::text,display_name FROM users ORDER BY display_name,id"
	}
	if r.URL.Path == "/api/subtopics" {
		sql = "SELECT s.id,s.direction_id,s.name,s.position FROM subtopics s JOIN directions d ON d.id=s.direction_id"
		if r.URL.Query().Has("direction_id") {
			n, e := number(r.URL.Query().Get("direction_id"), 32767)
			if e != nil {
				return e
			}
			var ok bool
			if e = s.db.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM directions WHERE id=$1)", n).Scan(&ok); e != nil {
				return e
			}
			if !ok {
				return fail(422, "validation_failed")
			}
			sql += " WHERE s.direction_id=$1"
			args = append(args, n)
		}
		sql += " ORDER BY d.position,s.position"
	}
	rows, e := s.db.Query(r.Context(), sql, args...)
	if e != nil {
		return e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		v, e := rows.Values()
		if e != nil {
			return e
		}
		m := map[string]any{}
		for i, f := range rows.FieldDescriptions() {
			m[f.Name] = v[i]
		}
		items = append(items, m)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	respond(w, 200, map[string]any{"items": items})
	return nil
}

type named struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}
type author struct {
	ID   string `json:"id"`
	Name string `json:"display_name"`
}
type publication struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Markdown  string    `json:"markdown,omitempty"`
	Author    author    `json:"author"`
	Direction named     `json:"direction"`
	Subtopic  named     `json:"subtopic"`
	Updated   time.Time `json:"updated_at"`
	Revision  string    `json:"revision_key,omitempty"`
}

const publicationSelect = `SELECT p.id::text,p.title,p.markdown,u.id::text,u.display_name,d.id,d.name,s.id,s.name,p.updated_at,p.revision_key::text FROM publications p JOIN users u ON u.id=p.author_id JOIN subtopics s ON s.id=p.subtopic_id JOIN directions d ON d.id=s.direction_id`

func scanPublication(row pgx.Row) (publication, error) {
	var p publication
	e := row.Scan(&p.ID, &p.Title, &p.Markdown, &p.Author.ID, &p.Author.Name, &p.Direction.ID, &p.Direction.Name, &p.Subtopic.ID, &p.Subtopic.Name, &p.Updated, &p.Revision)
	return p, e
}
func (s *Server) read(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	if e := validID(r.PathValue("id")); e != nil {
		return e
	}
	p, e := scanPublication(s.db.QueryRow(r.Context(), publicationSelect+" WHERE p.id=$1", r.PathValue("id")))
	if errors.Is(e, pgx.ErrNoRows) {
		return fail(404, "not_found")
	}
	if e != nil {
		return e
	}
	w.Header().Set("ETag", strconv.Quote(p.Revision))
	respond(w, 200, p)
	return nil
}
func (s *Server) list(w http.ResponseWriter, r *http.Request) error {
	if e := query(r, "q", "direction_id", "subtopic_id", "author_id", "date_from", "date_to", "page", "page_size"); e != nil {
		return e
	}
	if e := noBody(r); e != nil {
		return e
	}
	q := r.URL.Query()
	page, size := 1, 20
	var e error
	if q.Has("page") {
		page, e = number(q.Get("page"), 10000)
		if e != nil {
			return e
		}
	}
	if q.Has("page_size") {
		size, e = number(q.Get("page_size"), 50)
		if e != nil {
			return e
		}
	}
	tx, e := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	clauses := []string{"true"}
	args := []any{}
	add := func(col string, v any) {
		args = append(args, v)
		clauses = append(clauses, fmt.Sprintf(col, len(args)))
	}
	dir, sub := 0, 0
	for _, key := range []string{"direction_id", "subtopic_id"} {
		if q.Has(key) {
			n, e := number(q.Get(key), 32767)
			if e != nil {
				return e
			}
			var found int
			sql := "SELECT id FROM directions WHERE id=$1"
			if key == "subtopic_id" {
				sql = "SELECT direction_id FROM subtopics WHERE id=$1"
			}
			e = tx.QueryRow(r.Context(), sql, n).Scan(&found)
			if errors.Is(e, pgx.ErrNoRows) {
				return fail(422, "validation_failed")
			}
			if e != nil {
				return e
			}
			if key == "direction_id" {
				dir = n
				add("d.id=$%d", n)
			} else {
				sub = found
				add("s.id=$%d", n)
			}
		}
	}
	if dir != 0 && sub != 0 && dir != sub {
		return fail(422, "validation_failed")
	}
	if q.Has("author_id") {
		id := q.Get("author_id")
		if e = validID(id); e != nil {
			return e
		}
		var ok bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)", id).Scan(&ok); e != nil {
			return e
		}
		if !ok {
			return fail(422, "validation_failed")
		}
		add("p.author_id=$%d", id)
	}
	loc, _ := time.LoadLocation("Europe/Moscow")
	var from, to time.Time
	for _, key := range []string{"date_from", "date_to"} {
		if q.Has(key) {
			v, e := time.ParseInLocation("2006-01-02", q.Get(key), loc)
			if e != nil {
				return fail(400, "bad_request")
			}
			if key == "date_from" {
				from = v
				add("p.updated_at >= $%d", v)
			} else {
				to = v
				add("p.updated_at < $%d", v.AddDate(0, 0, 1))
			}
		}
	}
	if !from.IsZero() && !to.IsZero() && from.After(to) {
		return fail(422, "validation_failed")
	}
	search := strings.TrimSpace(q.Get("q"))
	if !utf8.ValidString(search) || utf8.RuneCountInString(search) > 200 {
		return fail(422, "validation_failed")
	}
	if search != "" {
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
		add("(p.title || E'\\n' || p.markdown) ILIKE $%d", "%"+escaped+"%")
	}
	where := " WHERE " + strings.Join(clauses, " AND ")
	var total int
	e = tx.QueryRow(r.Context(), "SELECT count(*) FROM publications p JOIN subtopics s ON s.id=p.subtopic_id JOIN directions d ON d.id=s.direction_id"+where, args...).Scan(&total)
	if e != nil {
		return e
	}
	args = append(args, size, (page-1)*size)
	rows, e := tx.Query(r.Context(), publicationSelect+where+fmt.Sprintf(" ORDER BY p.updated_at DESC,p.id DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if e != nil {
		return e
	}
	items := []publication{}
	for rows.Next() {
		p, e := scanPublication(rows)
		if e != nil {
			rows.Close()
			return e
		}
		p.Markdown = ""
		p.Revision = ""
		items = append(items, p)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	respond(w, 200, map[string]any{"items": items, "page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size})
	return nil
}

type publicationInput struct {
	Title    string `json:"title"`
	Subtopic int    `json:"subtopic_id"`
	Markdown string `json:"markdown"`
}

func mediaIDs(md string) ([]string, error) {
	ids := map[string]bool{}
	src := []byte(md)
	doc := goldmark.New().Parser().Parse(text.NewReader(src))
	e := ast.Walk(doc, func(n ast.Node, enter bool) (ast.WalkStatus, error) {
		if !enter {
			return ast.WalkContinue, nil
		}
		if im, ok := n.(*ast.Image); ok {
			d := string(im.Destination)
			if !strings.HasPrefix(d, "/media/") || !uuidPattern.MatchString(strings.TrimPrefix(d, "/media/")) {
				return ast.WalkStop, fail(422, "validation_failed")
			}
			ids[strings.TrimPrefix(d, "/media/")] = true
		}
		return ast.WalkContinue, nil
	})
	if e != nil {
		return nil, e
	}
	if len(ids) > 100 {
		return nil, fail(422, "validation_failed")
	}
	out := []string{}
	for id := range ids {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}
func (s *Server) mutate(w http.ResponseWriter, r *http.Request) error {
	if e := query(r); e != nil {
		return e
	}
	a, e := s.authorize(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if id != "" {
		if e = validID(id); e != nil {
			return e
		}
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		return fail(428, "precondition_required")
	}
	if e = validID(key); e != nil {
		return e
	}
	match := r.Header.Get("If-Match")
	if r.Method != "POST" {
		if match == "" {
			return fail(428, "precondition_required")
		}
		if len(match) != 38 || match[0] != '"' || match[37] != '"' || !uuidPattern.MatchString(match[1:37]) {
			return fail(400, "bad_request")
		}
	}
	in := publicationInput{}
	ids := []string{}
	if r.Method == "DELETE" {
		if e = noBody(r); e != nil {
			return e
		}
	} else {
		if e = decode(w, r, &in, 1<<20); e != nil {
			return e
		}
		if strings.TrimSpace(in.Title) == "" || utf8.RuneCountInString(in.Title) > 200 || strings.TrimSpace(in.Markdown) == "" || utf8.RuneCountInString(in.Markdown) > 200000 || len(in.Markdown) > 800000 || in.Subtopic < 1 || in.Subtopic > 32767 {
			return fail(422, "validation_failed")
		}
		ids, e = mediaIDs(in.Markdown)
		if e != nil {
			return e
		}
	}
	canonical, _ := json.Marshal(in)
	hash := sha256.Sum256([]byte(r.Method + "\n" + r.URL.Path + "\n" + match + "\n" + string(canonical)))
	tx, e := s.writeTx(r, a)
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "DELETE FROM mutation_receipts WHERE user_id=$1 AND expires_at<=now()", a.User.ID); e != nil {
		return e
	}
	var oldHash []byte
	var rid string
	var revision *string
	var status int
	e = tx.QueryRow(r.Context(), "SELECT request_hash,resource_id::text,result_revision::text,status_code FROM mutation_receipts WHERE user_id=$1 AND key=$2", a.User.ID, key).Scan(&oldHash, &rid, &revision, &status)
	if e == nil {
		if !bytes.Equal(hash[:], oldHash) {
			return fail(409, "idempotency_conflict")
		}
		w.Header().Set("Idempotency-Replayed", "true")
		mutationResponse(w, status, rid, revision)
		return nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	oldIDs := []string{}
	if r.Method != "POST" {
		var owner, rev string
		e = tx.QueryRow(r.Context(), "SELECT author_id::text,revision_key::text FROM publications WHERE id=$1 FOR UPDATE", id).Scan(&owner, &rev)
		if errors.Is(e, pgx.ErrNoRows) {
			return fail(404, "not_found")
		}
		if e != nil {
			return e
		}
		if owner != a.User.ID {
			return fail(403, "forbidden")
		}
		if match != strconv.Quote(rev) {
			return fail(412, "stale_publication")
		}
		rows, e := tx.Query(r.Context(), "SELECT media_id::text FROM publication_media WHERE publication_id=$1 ORDER BY media_id", id)
		if e != nil {
			return e
		}
		for rows.Next() {
			var v string
			if e = rows.Scan(&v); e != nil {
				rows.Close()
				return e
			}
			oldIDs = append(oldIDs, v)
		}
		rows.Close()
		if e = rows.Err(); e != nil {
			return e
		}
	}
	if r.Method != "DELETE" {
		var ok bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM subtopics WHERE id=$1)", in.Subtopic).Scan(&ok); e != nil {
			return e
		}
		if !ok {
			return fail(422, "validation_failed")
		}
	}
	all := append(append([]string{}, ids...), oldIDs...)
	sort.Strings(all)
	seen := map[string]bool{}
	for _, mid := range all {
		if seen[mid] {
			continue
		}
		seen[mid] = true
		if _, e = tx.Exec(r.Context(), "SELECT id FROM media WHERE id=$1 FOR UPDATE", mid); e != nil {
			return e
		}
	}
	for _, mid := range ids {
		if e = availableMedia(r, tx, mid, a.User.ID, false); e != nil {
			return e
		}
	}
	rev := uuid()
	status = 200
	if r.Method == "POST" {
		id = uuid()
		status = 201
		_, e = tx.Exec(r.Context(), "INSERT INTO publications(id,author_id,subtopic_id,title,markdown,revision_key) VALUES($1,$2,$3,$4,$5,$6)", id, a.User.ID, in.Subtopic, in.Title, in.Markdown, rev)
	} else if r.Method == "PUT" {
		_, e = tx.Exec(r.Context(), "UPDATE publications SET subtopic_id=$2,title=$3,markdown=$4,revision_key=$5,updated_at=clock_timestamp() WHERE id=$1", id, in.Subtopic, in.Title, in.Markdown, rev)
	} else {
		status = 204
		_, e = tx.Exec(r.Context(), "DELETE FROM publications WHERE id=$1", id)
	}
	if e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM publication_media WHERE publication_id=$1", id); e != nil {
		return e
	}
	for _, mid := range ids {
		if _, e = tx.Exec(r.Context(), "INSERT INTO publication_media(publication_id,media_id,owner_id) VALUES($1,$2,$3)", id, mid, a.User.ID); e != nil {
			return e
		}
	}
	for _, mid := range oldIDs {
		if _, e = tx.Exec(r.Context(), "UPDATE media SET lease_until=GREATEST(lease_until,clock_timestamp()+interval '24 hours') WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM publication_media WHERE media_id=$1)", mid); e != nil {
			return e
		}
	}
	revision = &rev
	if status == 204 {
		revision = nil
	}
	if _, e = tx.Exec(r.Context(), "INSERT INTO mutation_receipts(user_id,key,request_hash,resource_id,result_revision,status_code,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')", a.User.ID, key, hash[:], id, revision, status); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	mutationResponse(w, status, id, revision)
	return nil
}
func mutationResponse(w http.ResponseWriter, status int, id string, rev *string) {
	if status == 204 {
		w.WriteHeader(204)
		return
	}
	w.Header().Set("ETag", strconv.Quote(*rev))
	if status == 201 {
		w.Header().Set("Location", "/api/publications/"+id)
	}
	respond(w, status, map[string]string{"id": id, "revision_key": *rev})
}
