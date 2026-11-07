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
function Signal() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={"signal " + (paused ? "paused" : "")}>
      <svg viewBox="0 0 600 360" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="sea">
            <stop stopColor="#1662ef" />
            <stop offset=".5" stopColor="#00b7ce" />
            <stop offset="1" stopColor="#6cffa7" />
          </linearGradient>
        </defs>
        <g className="waves">
          {Array.from({ length: 22 }, (_, i) => (
            <path
              key={i}
              d={`M -50 ${100 + i * 6} C 90 ${-120 + i * 14}, 200 ${490 - i * 11}, 320 ${200 + i * 3} S 480 ${-40 + i * 13}, 650 ${140 + i * 6}`}
              stroke="url(#sea)"
              strokeWidth={i % 5 === 0 ? 2 : 1}
              opacity={0.35 + i / 40}
            />
          ))}
        </g>
        <circle cx="315" cy="180" r="67" stroke="#ffffff" strokeWidth=".7" />
        <circle cx="315" cy="180" r="4" fill="#123d5b" />
        <path
          d="M 315 100 V 120 M 315 240 V 260 M 235 180 H 255 M 375 180 H 395"
          stroke="#123d5b"
          strokeWidth="1"
        />
      </svg>
      <div className="signal-caption">
        <span>ЧЕЛОВЕК → СИГНАЛ → ПОНИМАНИЕ</span>
        <button
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Включить анимацию" : "Остановить анимацию"}
        >
          {paused ? "▷" : "Ⅱ"}
        </button>
      </div>
    </div>
  );
}
function Catalog() {
  const initial = new URLSearchParams(location.search);
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial),
  );
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
    history.replaceState(null, "", location.pathname + (q.size ? "?" + q : ""));
  }, [filters]);
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
            За каждым жестом —<br />
            <span>целый мир.</span>
          </h1>
          <p className="lead">
            Исследуем, как машины понимают эмоции,
            <br className="desktop" /> движения и человека. Делимся тем, что
            узнали.
          </p>
          <a className="primary" href="#materials">
            Исследовать материалы <span>↗</span>
          </a>
          <div className="hero-meta">
            <span>05 направлений</span>
            <span>01 общая идея</span>
          </div>
        </div>
        <Signal />
      </section>
      <section className="catalog" id="materials">
        <div className="section-heading">
          <div>
            <p className="eyebrow">БИБЛИОТЕКА ИССЛЕДОВАНИЙ</p>
            <h2>
              От вопроса к открытию<span className="mint-dot">.</span>
            </h2>
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
                  <span>00</span>Все исследования
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
                    <span>0{d.id}</span>
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
              <button type="submit">Найти ↗</button>
            </form>
            <div className="filters">
              <label>
                Подтема
                <select
                  value={filters.subtopic_id || ""}
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
                  <option value="">Все подтемы</option>
                  {subs.data?.items
                    .filter(
                      (s) =>
                        !filters.direction_id ||
                        String(s.direction_id) === filters.direction_id,
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
              <label>
                Обновлено с
                <input
                  type="date"
                  value={filters.date_from || ""}
                  onChange={(e) => change({ date_from: e.target.value })}
                />
              </label>
              <label>
                Обновлено по
                <input
                  type="date"
                  value={filters.date_to || ""}
                  onChange={(e) => change({ date_to: e.target.value })}
                />
              </label>
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
                      <span className="tag">Направление 0{p.direction.id}</span>
                      <h3>{p.title}</h3>
                      <p>{p.subtopic.name}</p>
                      <small>
                        {p.author.display_name} <span>·</span> Обновлено{" "}
                        {date(p.updated_at)}
                      </small>
                    </div>
                    <span className="row-arrow">↗</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty">
                <span className="empty-icon">↗</span>
                <h3>
                  {Object.values(filters).some(Boolean)
                    ? "Пока ничего не нашлось"
                    : "Здесь начнутся открытия"}
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
        Мои материалы ↗
      </a>
    </section>
  );
}
function About() {
  const authors = useData<{ items: Author[] }>("/api/authors");
  return (
    <section className="article">
      <p className="eyebrow">О ПРОЕКТЕ</p>
      <h1>
        Учимся понимать
        <br />
        <span>человека.</span>
      </h1>
      <p className="lead">
        НИР18 — научный блог команды, изучающей мультимодальное распознавание
        эмоций и жестов.
      </p>
      <p>
        Мы собираем теоретическую основу: от моделей эмоций и ключевых точек
        лица до динамических жестов, объединения сигналов и взаимодействия с
        роботами. Публикации блога — наши отчёты о научно-исследовательской
        работе.
      </p>
      <p>
        Практическая система распознавания и интеграция с ROS 2 относятся к
        будущему этапу. Здесь мы делимся изученными подходами, источниками и
        выводами.
      </p>
      <h2>Пять участников. Общий взгляд.</h2>
      {authors.error ? (
        <ErrorNotice message={authors.error} retry={authors.retry} />
      ) : (
        <ul className="team">
          {authors.data?.items.map((a) => (
            <li key={a.id}>{a.display_name}</li>
          ))}
        </ul>
      )}
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
        <a href="/" className="brand" aria-label="НИР18 — главная">
          нир<span>18</span>
          <i>↗</i>
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
              <a href="/workspace">Мой раздел ↗</a>
              <button disabled={busy} onClick={logout}>
                Выйти
              </button>
            </>
          ) : (
            <a className="login-link" href="/login">
              Вход <span>↗</span>
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
          нир<span>18</span>
        </a>
        <p>Изучаем человека. Создаём понимание.</p>
        <span>НАУЧНО-ИССЛЕДОВАТЕЛЬСКАЯ РАБОТА · 2026</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
