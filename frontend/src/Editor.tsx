import { BotChat, type EditorTab } from "./BotChat";
import { revealTextRange } from "./revealTextRange";
import { useEffect, useRef, useState } from "react";
import {
  api,
  APIError,
  NetworkError,
  type Named,
  type Publication,
  type Session,
  type Subtopic,
} from "./api";
import {
  date,
  ErrorNotice,
  openAfterWrite,
  topicLabel,
  useData,
} from "./shared";
import { Markdown } from "./Markdown";
import { Confirm, writeHeaders } from "./Workspace";
import { ImageUpload } from "./ImageUpload";
import { flushSync } from "react-dom";
import { CatalogSelect } from "./CatalogSelect";
import {
  imageBlock,
  invalidImage,
  selectedImageAlt,
  leaseImages,
} from "./editorMedia";

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
  bot = false,
}: {
  session: Session;
  id?: string;
  bot?: boolean;
}) {
  return id ? (
    <LoadArticle id={id} session={session} />
  ) : (
    <Editor session={session} bot={bot} />
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
  bot = false,
}: {
  session: Session;
  initial?: Publication;
  bot?: boolean;
}) {
  const dirs = useData<{ items: Named[] }>("/api/directions");
  const subs = useData<{ items: Subtopic[] }>("/api/subtopics");
  const [title, setTitle] = useState(initial?.title || "");
  const [direction, setDirection] = useState(
    String(initial?.direction.id || ""),
  );
  const [sub, setSub] = useState(String(initial?.subtopic.id || ""));
  const [body, setBody] = useState(initial?.markdown || "");
  const [tab, setTab] = useState<EditorTab>(bot ? "chat" : "edit");
  const [chatDirty, setChatDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [upload, setUpload] = useState<{
    start: number;
    end: number;
    scrollTop: number;
    alt: string;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"title" | "direction" | "subtopic" | "body", string>>
  >({});
  const [pendingLeave, setPendingLeave] = useState<{
    proceed: () => void;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [leaseError, setLeaseError] = useState<Error | null>(null);
  const [connectionError, setConnectionError] = useState<NetworkError | null>(
    null,
  );
  const chatConnectionVersion = useRef(0);
  const issue = error || leaseError || (tab !== "chat" && connectionError);
  const signInAgain =
    issue instanceof APIError &&
    (issue.status === 401 || issue.code === "csrf_failed");
  const [conflict, setConflict] = useState(false);
  const [csrf, setCsrf] = useState(session.csrf_token);
  const text = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(body);
  const leaving = useRef(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const dirty =
    chatDirty ||
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
    const linkClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey
      )
        return;
      const link =
        e.target instanceof Element
          ? e.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self") ||
        link.origin !== location.origin
      )
        return;
      if (
        link.hash &&
        link.pathname === location.pathname &&
        link.search === location.search
      )
        return;
      e.preventDefault();
      const href = link.href;
      setPendingLeave({
        proceed: () => {
          leaving.current = true;
          location.assign(href);
        },
      });
    };
    const logout = (e: Event) => {
      e.preventDefault();
      setPendingLeave({ proceed: (e as CustomEvent<() => void>).detail });
    };
    document.addEventListener("click", linkClick);
    const loggedOut = () => {
      leaving.current = true;
    };
    window.addEventListener("workspace-logout-complete", loggedOut);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("workspace-leave", logout);
    return () => {
      document.removeEventListener("click", linkClick);
      window.removeEventListener("workspace-logout-complete", loggedOut);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("workspace-leave", logout);
    };
  }, [dirty]);
  useEffect(() => {
    let active = true;
    let renewal = 0;
    async function renew() {
      const attempt = ++renewal;
      const version = chatConnectionVersion.current;
      const currentAttempt = () => active && attempt === renewal;
      try {
        const current = await api<Session>("/api/auth/me");
        if (current.user.id !== session.user.id)
          throw new APIError(401, "Войдите снова под исходным аккаунтом.");
        if (!currentAttempt()) return;
        setCsrf(current.csrf_token);
        await leaseImages(latest.current, current.csrf_token);
        if (!currentAttempt()) return;
        setLeaseError(null);
        if (version === chatConnectionVersion.current) setConnectionError(null);
      } catch (e) {
        if (!currentAttempt()) return;
        if (e instanceof NetworkError) {
          if (version === chatConnectionVersion.current) setConnectionError(e);
        } else {
          setLeaseError(e as Error);
          if (version === chatConnectionVersion.current)
            setConnectionError(null);
        }
      }
    }
    const timer = window.setInterval(renew, 600000);
    const visible = () => {
      if (!document.hidden) void renew();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", renew);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", renew);
    };
  }, [session.user.id]);
  function edited(field: keyof typeof fieldErrors) {
    setFieldErrors((old) => ({ ...old, [field]: undefined }));
    if (!conflict) setError(null);
  }
  function currentSelection() {
    const el = text.current!;
    return {
      start: el.selectionStart,
      end: el.selectionEnd,
      scrollTop: el.scrollTop,
    };
  }
  function replaceSelection(
    range: ReturnType<typeof currentSelection>,
    replacement: string,
    selectFrom: number,
    selectTo: number,
  ) {
    flushSync(() => {
      setBody(body.slice(0, range.start) + replacement + body.slice(range.end));
      edited("body");
      setUpload(null);
    });
    const el = text.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(range.start + selectFrom, range.start + selectTo);
    el.scrollTop = range.scrollTop;
  }
  function insert(prefix: string, fallback: string, suffix: string) {
    const range = currentSelection();
    const content = body.slice(range.start, range.end) || fallback;
    replaceSelection(
      range,
      prefix + content + suffix,
      prefix.length,
      prefix.length + content.length,
    );
  }
  function openUpload() {
    const range = currentSelection();
    setUpload({
      ...range,
      alt: selectedImageAlt(body, range.start, range.end),
    });
  }
  const dirName = dirs.data?.items.find(
    (d) => String(d.id) === direction,
  )?.name;
  const subName = subs.data?.items.find((s) => String(s.id) === sub)?.name;
  const action = initial ? "Сохранить изменения" : "Опубликовать";
  function topicErrors() {
    const errors: typeof fieldErrors = {};
    if (!title.trim()) errors.title = "Введите заголовок статьи.";
    else if ([...title].length > 200)
      errors.title = "Сократите заголовок до 200 символов.";
    if (!direction) errors.direction = "Выберите направление.";
    if (!sub) errors.subtopic = "Выберите подтему.";
    return errors;
  }
  function validateTopic() {
    const errors = topicErrors();
    const first = Object.keys(errors)[0];
    if (!first) return true;
    setFieldErrors(errors);
    document.getElementById("article-" + first)?.focus();
    return false;
  }
  function review() {
    setError(null);
    const errors = topicErrors();
    const image = invalidImage(body);
    if (!body.trim()) errors.body = "Введите текст статьи.";
    else if ([...body].length > 200000)
      errors.body = "Сократите текст до 200 000 символов.";
    else if (image)
      errors.body =
        "Загрузите изображение «" +
        (image.url || "пустая ссылка") +
        "» через кнопку «Добавить изображение».";
    const first = Object.keys(errors)[0];
    if (first) {
      flushSync(() => {
        setTab("edit");
        setFieldErrors(errors);
      });
      document.getElementById("article-" + first)?.focus();
      if (first === "body" && image && text.current)
        revealTextRange(text.current, image.start, image.end);
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
        await leaseImages(body, csrf);
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
    <section className={bot ? "work-page editor bot-page" : "work-page editor"}>
      <div>
        <a href="/workspace">← Мой раздел</a>
        {bot && <span className="bot-crumb"> / ИИ-бот</span>}
      </div>
      <h1>
        {bot
          ? "Новый отчёт"
          : initial
            ? "Редактирование статьи"
            : "Новая публикация"}
      </h1>
      {bot && session.bot_mode === "stub" && (
        <p className="bot-mode">
          Тестовая заглушка · реальная модель не подключена
        </p>
      )}
      <div className="editor-sheet">
        <div className="editor-tabs" role="group" aria-label="Режим просмотра">
          {bot && (
            <button
              aria-pressed={tab === "chat"}
              onClick={() => setTab("chat")}
            >
              Чат
            </button>
          )}
          <button aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>
            Редактор Markdown
          </button>
          <button
            aria-pressed={tab === "preview"}
            onClick={() => setTab("preview")}
          >
            Предпросмотр
          </button>
        </div>
        {tab === "preview" ? (
          <article className="editor-preview">
            <p className="eyebrow">{dirName}</p>
            <h2>{title || "Без заголовка"}</h2>
            {subName && (
              <p className="topic-meta">Подтема · {topicLabel(subName)}</p>
            )}
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
            <label htmlFor="article-title">
              Заголовок
              <input
                id="article-title"
                value={title}
                aria-invalid={!!fieldErrors.title}
                aria-describedby={fieldErrors.title ? "title-error" : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  edited("title");
                }}
              />
            </label>
            {fieldErrors.title && (
              <small id="title-error" className="field-error" role="alert">
                {fieldErrors.title}
              </small>
            )}
            <div className="editor-catalog">
              <CatalogSelect
                id="article-direction"
                label="Направление"
                placeholder="Выберите направление"
                value={direction}
                options={dirs.data?.items || []}
                error={fieldErrors.direction}
                onChange={(value) => {
                  if (value !== direction) setSub("");
                  setDirection(value);
                  edited("direction");
                }}
              />
              <CatalogSelect
                id="article-subtopic"
                label="Подтема"
                placeholder={
                  direction
                    ? "Выберите подтему"
                    : "Сначала выберите направление"
                }
                value={sub}
                disabled={!direction}
                options={
                  subs.data?.items.filter(
                    (s) => String(s.direction_id) === direction,
                  ) || []
                }
                error={fieldErrors.subtopic}
                onChange={(value) => {
                  setSub(value);
                  edited("subtopic");
                }}
              />
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
          </>
        )}
        {bot && (
          <BotChat
            tab={tab}
            csrf={csrf}
            title={title}
            subtopic={sub}
            body={body}
            validateTopic={validateTopic}
            connectionError={connectionError}
            onConnectionChange={(failure) => {
              chatConnectionVersion.current++;
              setConnectionError(failure);
            }}
            onDirty={setChatDirty}
            openEditor={() => setTab("edit")}
            apply={(markdown) => {
              setBody(markdown);
              edited("body");
            }}
          />
        )}
        {tab === "edit" && (
          <>
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
              <button onClick={openUpload}>Добавить изображение</button>
            </div>
            <textarea
              id="article-body"
              ref={text}
              value={body}
              aria-invalid={!!fieldErrors.body}
              aria-describedby={fieldErrors.body ? "body-error" : undefined}
              onChange={(e) => {
                setBody(e.target.value);
                edited("body");
              }}
              placeholder="Начните с вопроса исследования…"
            />
            {fieldErrors.body && (
              <small id="body-error" className="field-error" role="alert">
                {fieldErrors.body}
              </small>
            )}
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
        {tab !== "chat" && (
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
        )}
      </div>
      {upload && (
        <ImageUpload
          session={{ ...session, csrf_token: csrf }}
          initialAlt={upload.alt}
          cancel={() => setUpload(null)}
          insert={(markup) => {
            const block = imageBlock(body, upload.start, upload.end, markup);
            replaceSelection(upload, block, block.length, block.length);
          }}
        />
      )}
      {pendingLeave && (
        <Confirm
          title="Покинуть редактор?"
          action="Покинуть"
          cancelLabel="Остаться"
          busy={false}
          cancel={() => setPendingLeave(null)}
          submit={() => {
            setPendingLeave(null);
            pendingLeave.proceed();
          }}
        >
          <p>Несохранённые изменения будут потеряны.</p>
        </Confirm>
      )}
      {confirm && (
        <Confirm
          title={initial ? "Обновить публикацию?" : "Опубликовать материал?"}
          action={action}
          busy={busy}
          cancel={() => setConfirm(false)}
          submit={save}
        >
          <p className="confirm-title">{title}</p>
          <p className="byline">Автор · {session.user.display_name}</p>
          <details className="confirm-catalog">
            <summary>Направление и подтема</summary>
            <dl>
              <dt>Направление</dt>
              <dd>{dirName}</dd>
              <dt>Подтема</dt>
              <dd>{subName}</dd>
            </dl>
          </details>
        </Confirm>
      )}
    </section>
  );
}
