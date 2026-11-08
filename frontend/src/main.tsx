import { useEffect, useState, lazy, Suspense, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  APIError,
  type Named,
  type Subtopic,
  type Author,
  type Session,
  type Listing,
  type Publication,
} from "./api";
const Markdown = lazy(() =>
  import("./Markdown").then((module) => ({ default: module.Markdown })),
);
import "./style.css";
import { About } from "./About";
import { ResearchSignal } from "./ResearchSignal";
import { DateFilters } from "./DateFilters";

const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      {message} {retry && <button onClick={retry}>Повторить</button>}
    </div>
  );
}
function useData<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(url, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, version]);
  return { data, error, loading, retry: () => setVersion((v) => v + 1) };
}
function Catalog() {
  const initial = new URLSearchParams(location.search);
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial),
  );
  const [filterReset, setFilterReset] = useState(0);
  const [search, setSearch] = useState(initial.get("q") || "");
  const dirs = useData<{ items: Named[] }>("/api/directions");
  const subs = useData<{ items: Subtopic[] }>("/api/subtopics");
  const authors = useData<{ items: Author[] }>("/api/authors");
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  );
  const listing = useData<Listing>("/api/publications?" + params.toString());
  const change = (values: Record<string, string>) =>
    setFilters((old) => ({ ...old, page: "1", ...values }));
  useEffect(() => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    history.replaceState(
      null,
      "",
      location.pathname + (q.size ? "?" + q : "") + location.hash,
    );
  }, [filters]);
  useEffect(() => {
    if (location.hash === "#materials") {
      document.getElementById("materials")?.scrollIntoView();
    }
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change({ q: search.trim() });
  };
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="dot" /> ОТКРЫТЫЙ ИССЛЕДОВАТЕЛЬСКИЙ БЛОГ
          </p>
          <h1>
            За каждым жестом
            <br />
            <span>целый мир.</span>
          </h1>
          <p className="lead">
            Исследуем, как алгоритмы распознают мимику, динамические жесты и
            эмоциональные состояния человека.
          </p>
          <a className="primary" href="#materials">
            Исследовать материалы <span aria-hidden="true">↓</span>
          </a>
          <div className="hero-meta">
            <span>
              <strong>5</strong> направлений
            </span>
            <span>
              <strong>15</strong> подтем
            </span>
            <span>
              <strong>5</strong> участников
            </span>
          </div>
        </div>
        <ResearchSignal />
      </section>
      <section className="catalog" id="materials">
        <div className="section-heading">
          <div>
            <p className="eyebrow">БИБЛИОТЕКА ИССЛЕДОВАНИЙ</p>
            <h2>Каталог материалов НИР</h2>
          </div>
          <span className="count">{listing.data?.total ?? "—"} материалов</span>
        </div>
        <div className="catalog-layout">
          <aside>
            <h3>Направления</h3>
            {dirs.error ? (
              <ErrorNotice message={dirs.error} retry={dirs.retry} />
            ) : (
              <nav aria-label="Направления">
                <button
                  className={!filters.direction_id ? "selected" : ""}
                  onClick={() => change({ direction_id: "", subtopic_id: "" })}
                >
                  <span aria-hidden="true">∷</span>Все исследования
                </button>
                {dirs.data?.items.map((d) => (
                  <button
                    key={d.id}
                    className={
                      filters.direction_id === String(d.id) ? "selected" : ""
                    }
                    onClick={() =>
                      change({ direction_id: String(d.id), subtopic_id: "" })
                    }
                  >
                    <span aria-hidden="true">{d.id}</span>
                    {d.name}
                  </button>
                ))}
              </nav>
            )}
            <p className="side-note">
              От распознавания мимики
              <br />
              до взаимодействия с роботами.
            </p>
          </aside>
          <div className="results">
            <form className="search" onSubmit={submit}>
              <label className="sr-only" htmlFor="search">
                Поиск по публикациям
              </label>
              <input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Что будем исследовать?"
                maxLength={200}
              />
              <button type="submit">Найти</button>
            </form>
            <div className="filters">
              <label>
                Подтема
                <select
                  value={filters.subtopic_id || ""}
                  disabled={!filters.direction_id || !subs.data}
                  title={
                    !filters.direction_id
                      ? "Сначала выберите направление"
                      : "Подтема выбранного направления"
                  }
                  onChange={(e) => {
                    const s = subs.data?.items.find(
                      (s) => String(s.id) === e.target.value,
                    );
                    change({
                      subtopic_id: e.target.value,
                      ...(s ? { direction_id: String(s.direction_id) } : {}),
                    });
                  }}
                >
                  <option value="">
                    {filters.direction_id
                      ? "Все подтемы"
                      : "Выберите направление"}
                  </option>
                  {subs.data?.items
                    .filter(
                      (s) => String(s.direction_id) === filters.direction_id,
                    )
                    .map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Автор
                <select
                  value={filters.author_id || ""}
                  onChange={(e) => change({ author_id: e.target.value })}
                >
                  <option value="">Все авторы</option>
                  {authors.data?.items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <DateFilters key={filterReset} value={filters} onApply={change} />
            </div>
            {(subs.error || authors.error) && (
              <ErrorNotice
                message="Не удалось загрузить фильтры"
                retry={() => {
                  subs.retry();
                  authors.retry();
                }}
              />
            )}
            <div className="result-meta">
              <span>Сначала обновлённые</span>
              <button
                className="text-button"
                onClick={() => {
                  setFilters({});
                  setFilterReset((version) => version + 1);
                  setSearch("");
                }}
              >
                Сбросить фильтры
              </button>
            </div>
            {listing.loading ? (
              <p className="empty" role="status">
                Собираем материалы…
              </p>
            ) : listing.error ? (
              <ErrorNotice message={listing.error} retry={listing.retry} />
            ) : listing.data?.items.length ? (
              <div>
                {listing.data.items.map((p) => (
                  <a
                    className="article-row"
                    href={"/publications/" + p.id}
                    key={p.id}
                  >
                    <div>
                      <span className="tag">Направление {p.direction.id}</span>
                      <h3>{p.title}</h3>
                      <p>{p.subtopic.name}</p>
                      <small>
                        {p.author.display_name} <span>·</span> Обновлено{" "}
                        {date(p.updated_at)}
                      </small>
                    </div>
                    <span className="row-arrow">→</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">
                  ≡
                </span>
                <h3>
                  {Object.values(filters).some(Boolean)
                    ? "Пока ничего не нашлось"
                    : "Материалы готовятся к публикации"}
                </h3>
                <p>
                  {Object.values(filters).some(Boolean)
                    ? "Попробуйте другой запрос или сбросьте фильтры."
                    : "Команда готовит первые публикации. Скоро здесь появятся наши исследования."}
                </p>
              </div>
            )}
            {listing.data && listing.data.total_pages > 1 && (
              <div className="pagination">
                <button
                  disabled={listing.loading || listing.data.page <= 1}
                  onClick={() =>
                    change({ page: String(listing.data!.page - 1) })
                  }
                >
                  ← Назад
                </button>
                <span>
                  {listing.data.page} / {listing.data.total_pages}
                </span>
                <button
                  disabled={
                    listing.loading ||
                    listing.data.page >= listing.data.total_pages
                  }
                  onClick={() =>
                    change({ page: String(listing.data!.page + 1) })
                  }
                >
                  Далее →
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
function Article({ id }: { id: string }) {
  const { data, error, loading, retry } = useData<Publication>(
    "/api/publications/" + encodeURIComponent(id),
  );
  if (loading) return <p className="empty">Загрузка статьи…</p>;
  if (error) return <ErrorNotice message={error} retry={retry} />;
  return (
    data && (
      <article className="article">
        <a href="/">← Все исследования</a>
        <p className="eyebrow">{data.direction.name}</p>
        <h1>{data.title}</h1>
        <p className="byline">
          {data.author.display_name} · Обновлено {date(data.updated_at)}
        </p>
        <p className="subtopic">{data.subtopic.name}</p>
        <Suspense fallback={<p>Подготавливаем статью…</p>}>
          <Markdown text={data.markdown || ""} />
        </Suspense>
      </article>
    )
  );
}
function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const session = await api<Session>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: form.get("login"),
          password: form.get("password"),
        }),
      });
      onLogin(session);
      location.assign("/workspace");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login">
      <p className="eyebrow">ДЛЯ УЧАСТНИКОВ КОМАНДЫ</p>
      <h1>
        С возвращением<span className="mint-dot">.</span>
      </h1>
      <p>Войдите в свой исследовательский аккаунт.</p>
      <form onSubmit={submit}>
        <label>
          Логин
          <input name="login" required autoComplete="username" maxLength={32} />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type={visible ? "text" : "password"}
            required
            autoComplete="current-password"
            maxLength={256}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          Показать пароль
        </label>
        {error && <ErrorNotice message={error} />}
        <button className="primary" disabled={busy}>
          {busy ? "Входим…" : "Войти →"}
        </button>
      </form>
      <small>
        Аккаунты создаются для пяти участников команды. Если нужен пароль,
        обратитесь к разработчику сайта.
      </small>
    </section>
  );
}
function Workspace({ session }: { session: Session | null | undefined }) {
  if (session === undefined) return <p className="empty">Проверяем вход…</p>;
  if (!session)
    return (
      <section className="empty">
        <h1>Войдите в аккаунт</h1>
        <a className="primary" href="/login">
          Перейти ко входу →
        </a>
      </section>
    );
  return (
    <section className="article">
      <p className="eyebrow">РАБОЧИЙ РАЗДЕЛ</p>
      <h1>Здравствуйте, {session.user.display_name.split(" ")[0]}.</h1>
      <p>
        Ваш аккаунт подключён. Редактор публикаций и чат появятся на следующем
        этапе.
      </p>
      <a
        className="primary"
        href={"/?author_id=" + session.user.id + "#materials"}
      >
        Мои материалы →
      </a>
    </section>
  );
}
function App() {
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Session>("/api/auth/me")
      .then(setSession)
      .catch((e) => {
        setSession(null);
        if (!(e instanceof APIError && e.status === 401)) setError(e.message);
      });
  }, []);
  async function logout() {
    if (!session) return;
    setBusy(true);
    try {
      await api("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": session.csrf_token },
      });
      setSession(null);
      location.assign("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const path = location.pathname;
  const article = /^\/publications\/([^/]+)$/.exec(path);
  return (
    <>
      <a className="skip" href="#main">
        К содержимому
      </a>
      <header>
        <a href="/" className="brand" aria-label="Аффект.МЭИ — главная">
          Аффект<span>.МЭИ</span>
        </a>
        <nav aria-label="Основная навигация">
          <a href="/" aria-current={path === "/" ? "page" : undefined}>
            Исследования
          </a>
          <a
            href="/about"
            aria-current={path === "/about" ? "page" : undefined}
          >
            О проекте
          </a>
        </nav>
        <div className="account">
          {session ? (
            <>
              <a href="/workspace">Мой раздел →</a>
              <button disabled={busy} onClick={logout}>
                Выйти
              </button>
            </>
          ) : (
            <a className="login-link" href="/login">
              Вход
            </a>
          )}
        </div>
      </header>
      <main id="main">
        {error && <ErrorNotice message={error} />}{" "}
        {article ? (
          <Article id={article[1]} />
        ) : path === "/" ? (
          <Catalog />
        ) : path === "/login" ? (
          <Login onLogin={setSession} />
        ) : path === "/workspace" ? (
          <Workspace session={session} />
        ) : path === "/about" ? (
          <About />
        ) : (
          <section className="empty">
            <h1>Страница не найдена</h1>
            <a href="/">Вернуться к исследованиям</a>
          </section>
        )}
      </main>
      <footer>
        <a className="brand" href="/">
          Аффект<span>.МЭИ</span>
        </a>
        <p>Изучаем человека. Создаём понимание.</p>
        <span>НАУЧНО-ИССЛЕДОВАТЕЛЬСКАЯ РАБОТА · 2026</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
