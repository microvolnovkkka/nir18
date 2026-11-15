import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  APIError,
  type Named,
  type Publication,
  type Session,
  type Subtopic,
} from "./api";
import { date, ErrorNotice, openAfterWrite, useData } from "./shared";
import { Markdown } from "./Markdown";
import { Confirm, writeHeaders } from "./Workspace";
import { ImageUpload } from "./ImageUpload";
import { leaseImages } from "./editorMedia";

const tools = [
  ["Заголовок", "## ", "Заголовок", ""],
  ["Список", "- ", "Пункт", ""],
  [
    "Таблица",
    "\n| ",
    "Столбец",
    " | Значение |\n| --- | --- |\n| Строка | Данные |\n",
  ],
  ["Ссылка", "[", "Источник", "](https://)"],
  ["Код", "\n```\n", "код", "\n```\n"],
  ["Формула", "$", "x^2", "$"],
];
export default function EditorRoute({
  session,
  id,
}: {
  session: Session;
  id?: string;
}) {
  return id ? (
    <LoadArticle id={id} session={session} />
  ) : (
    <Editor session={session} />
  );
}
function LoadArticle({ session, id }: { session: Session; id: string }) {
  const article = useData<Publication>("/api/publications/" + id);
  if (article.loading) return <p className="empty">Загружаем публикацию…</p>;
  if (article.error)
    return <ErrorNotice message={article.error} retry={article.retry} />;
  if (!article.data || article.data.author.id !== session.user.id)
    return (
      <section className="empty">
        <h1>Редактирование недоступно</h1>
        <a href={"/publications/" + id}>Открыть статью</a>
      </section>
    );
  return <Editor session={session} initial={article.data} />;
}

export function Editor({
  session,
  initial,
}: {
  session: Session;
  initial?: Publication;
}) {
  const dirs = useData<{ items: Named[] }>("/api/directions");
  const subs = useData<{ items: Subtopic[] }>("/api/subtopics");
  const [title, setTitle] = useState(initial?.title || "");
  const [direction, setDirection] = useState(
    String(initial?.direction.id || ""),
  );
  const [sub, setSub] = useState(String(initial?.subtopic.id || ""));
  const [body, setBody] = useState(initial?.markdown || "");
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [leaseError, setLeaseError] = useState<Error | null>(null);
  const issue = error || leaseError;
  const signInAgain =
    issue instanceof APIError &&
    (issue.status === 401 || issue.code === "csrf_failed");
  const [conflict, setConflict] = useState(false);
  const [csrf, setCsrf] = useState(session.csrf_token);
  const text = useRef<HTMLTextAreaElement>(null);
  const selection = useRef([0, 0]);
  const latest = useRef(body);
  const leaving = useRef(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const dirty =
    title !== (initial?.title || "") ||
    sub !== String(initial?.subtopic.id || "") ||
    direction !== String(initial?.direction.id || "") ||
    body !== (initial?.markdown || "");
  useEffect(() => {
    latest.current = body;
  }, [body]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      if (!leaving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const logout = (e: Event) => {
      if (!window.confirm("Выйти и потерять несохранённые изменения?"))
        e.preventDefault();
    };
    const loggedOut = () => {
      leaving.current = true;
    };
    window.addEventListener("workspace-logout-complete", loggedOut);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("workspace-leave", logout);
    return () => {
      window.removeEventListener("workspace-logout-complete", loggedOut);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("workspace-leave", logout);
    };
  }, [dirty]);
  useEffect(() => {
    let active = true;
    async function renew() {
      try {
        const current = await api<Session>("/api/auth/me");
        if (current.user.id !== session.user.id)
          throw new APIError(401, "Войдите снова под исходным аккаунтом.");
        if (!active) return;
        setCsrf(current.csrf_token);
        await leaseImages(latest.current, current.csrf_token);
        if (active) setLeaseError(null);
      } catch (e) {
        if (active) setLeaseError(e as Error);
      }
    }
    const timer = window.setInterval(renew, 600000);
    const visible = () => {
      if (!document.hidden) void renew();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [session.user.id]);
  function remember() {
    if (text.current)
      selection.current = [
        text.current.selectionStart,
        text.current.selectionEnd,
      ];
  }
  const insert = useCallback(
    (prefix: string, fallback = "", suffix = "") => {
      const [start, end] = selection.current;
      const selected = body.slice(start, end) || fallback;
      const replacement = prefix + selected + suffix;
      setBody(body.slice(0, start) + replacement + body.slice(end));
      requestAnimationFrame(() => {
        text.current?.focus();
        text.current?.setSelectionRange(
          start + prefix.length,
          start + prefix.length + selected.length,
        );
      });
    },
    [body],
  );
  const dirName = dirs.data?.items.find(
    (d) => String(d.id) === direction,
  )?.name;
  const subName = subs.data?.items.find((s) => String(s.id) === sub)?.name;
  const action = initial ? "Сохранить изменения" : "Опубликовать";
  function review() {
    setError(null);
    if (!title.trim() || !sub || !body.trim()) {
      setError(
        new Error("Заполните заголовок, направление, подтему и текст статьи."),
      );
      return;
    }
    if ([...title].length > 200 || [...body].length > 200000) {
      setError(
        new Error(
          "Допустимо до 200 символов в заголовке и до 200 000 в тексте.",
        ),
      );
      return;
    }
    setConfirm(true);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = JSON.stringify({
        title: title.trim(),
        subtopic_id: Number(sub),
        markdown: body,
      });
      if (retry.current?.payload !== payload) {
        await leaseImages(body, csrf, true);
        retry.current = { payload, key: crypto.randomUUID() };
      }
      const result = await api<{ id: string }>(
        initial ? "/api/publications/" + initial.id : "/api/publications",
        {
          method: initial ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...writeHeaders(
              { ...session, csrf_token: csrf },
              retry.current.key,
              initial?.revision_key,
            ),
          },
          body: payload,
        },
      );
      leaving.current = true;
      openAfterWrite(
        "/publications/" + result.id,
        initial ? "Статья обновлена." : "Статья опубликована.",
      );
    } catch (e) {
      setConfirm(false);
      setError(e as Error);
      if (e instanceof APIError && e.status < 500) retry.current = null;
      if (e instanceof APIError && e.status === 412) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="work-page editor">
      <a href="/workspace">← Мой раздел</a>
      <h1>{initial ? "Редактирование статьи" : "Новая публикация"}</h1>
      <div className="editor-sheet">
        <div className="editor-tabs" aria-label="Режим просмотра">
          <button aria-pressed={!preview} onClick={() => setPreview(false)}>
            Редактор Markdown
          </button>
          <button aria-pressed={preview} onClick={() => setPreview(true)}>
            Предпросмотр
          </button>
        </div>
        {preview ? (
          <article className="editor-preview">
            <p className="eyebrow">{dirName}</p>
            <h2>{title || "Без заголовка"}</h2>
            <p>{subName}</p>
            <p className="byline">
              {session.user.display_name} ·{" "}
              {initial
                ? "Обновлено " + date(initial.updated_at)
                : "Дата будет назначена при публикации"}
            </p>
            {body ? (
              <Markdown text={body} />
            ) : (
              <p>Введите текст во вкладке редактора.</p>
            )}
          </article>
        ) : (
          <>
            <label>
              Заголовок
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="editor-catalog">
              <label>
                <span id="direction-label">Направление</span>
                <select
                  aria-labelledby="direction-label"
                  value={direction}
                  onChange={(e) => {
                    setDirection(e.target.value);
                    setSub("");
                  }}
                >
                  <option value="">Выберите направление</option>
                  {dirs.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span id="subtopic-label">Подтема</span>
                <select
                  aria-labelledby="subtopic-label"
                  disabled={!direction}
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                >
                  <option value="">Выберите подтему</option>
                  {subs.data?.items
                    .filter((s) => String(s.direction_id) === direction)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {(dirs.error || subs.error) && (
              <ErrorNotice
                message="Не удалось загрузить каталог."
                retry={() => {
                  dirs.retry();
                  subs.retry();
                }}
              />
            )}
            <p className="byline">
              Автор · {session.user.display_name}
              <br />
              Обновлено ·{" "}
              {initial
                ? date(initial.updated_at) + " (изменится при сохранении)"
                : "Будет назначено при публикации"}
            </p>
            <label htmlFor="article-body">Текст статьи</label>
            <div className="edit-tools">
              {tools.map(([label, start, placeholder, end]) => (
                <button
                  key={label}
                  onClick={() => insert(start, placeholder, end)}
                >
                  {label}
                </button>
              ))}
              <button onClick={() => setUpload(true)}>
                Добавить изображение
              </button>
            </div>
            <textarea
              id="article-body"
              ref={text}
              value={body}
              onSelect={remember}
              onBlur={remember}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Начните с вопроса исследования…"
            />
          </>
        )}
        {issue && (
          <div>
            <ErrorNotice
              message={
                signInAgain
                  ? "Войдите в исходный аккаунт в другой вкладке и вернитесь в редактор. Введённый текст останется здесь."
                  : issue.message
              }
            />
            {signInAgain && (
              <a href="/login" target="_blank" rel="noopener">
                Войти повторно в другой вкладке
              </a>
            )}
          </div>
        )}
        {conflict && initial && (
          <a
            href={"/publications/" + initial.id}
            target="_blank"
            rel="noopener"
          >
            Открыть актуальную статью в новой вкладке
          </a>
        )}
        <div className="editor-bottom">
          <span>{dirty ? "Есть несохранённые изменения" : ""}</span>
          <button
            className="primary"
            disabled={busy || conflict || !dirs.data || !subs.data}
            onClick={review}
          >
            {action}
          </button>
        </div>
      </div>
      {upload && (
        <ImageUpload
          session={{ ...session, csrf_token: csrf }}
          cancel={() => setUpload(false)}
          insert={(markup) => {
            const [start, end] = selection.current;
            setBody(body.slice(0, start) + markup + body.slice(end));
            setUpload(false);
            requestAnimationFrame(() => {
              text.current?.focus();
              text.current?.setSelectionRange(
                start + markup.length,
                start + markup.length,
              );
            });
          }}
        />
      )}
      {confirm && (
        <Confirm
          title={initial ? "Обновить публикацию?" : "Опубликовать материал?"}
          action={action}
          busy={busy}
          cancel={() => setConfirm(false)}
          submit={save}
        >
          <strong>{title}</strong>
          <p>
            {dirName} · {subName}
          </p>
          <p>Автор · {session.user.display_name}</p>
        </Confirm>
      )}
    </section>
  );
}
