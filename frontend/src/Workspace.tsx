import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  APIError,
  type Session,
  type Publication,
  type Listing,
} from "./api";
import { date, ErrorNotice, useData } from "./shared";

export function Confirm({
  title,
  action,
  busy,
  cancel,
  submit,
  children,
  cancelLabel = "Отмена",
}: {
  title: string;
  action: string;
  busy: boolean;
  cancel: () => void;
  submit: () => void;
  children: ReactNode;
  cancelLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="work-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) cancel();
      }}
    >
      <h2>{title}</h2>
      {children}
      <div className="author-actions">
        <button autoFocus disabled={busy} onClick={cancel}>
          {cancelLabel}
        </button>
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? "Отправляем…" : action}
        </button>
      </div>
    </dialog>
  );
}

// Повтор после потери ответа использует тот же ключ и версию.
export function writeHeaders(session: Session, key: string, revision?: string) {
  return {
    "X-CSRF-Token": session.csrf_token,
    "Idempotency-Key": key,
    ...(revision ? { "If-Match": '"' + revision + '"' } : {}),
  };
}
export function DeletePublication({
  item,
  session,
  done,
}: {
  item: Publication;
  session: Session;
  done: () => void;
}) {
  const [target, setTarget] = useState<{ article: Publication; key: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function prepare() {
    setError("");
    setBusy(true);
    try {
      const article = item.revision_key
        ? item
        : await api<Publication>("/api/publications/" + item.id);
      if (!article.revision_key || article.author.id !== session.user.id)
        throw new Error("Удаление недоступно.");
      setTarget({ article, key: crypto.randomUUID() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/publications/" + item.id, {
        method: "DELETE",
        headers: writeHeaders(session, target.key, target.article.revision_key),
      });
      setTarget(undefined);
      done();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof APIError && [403, 404, 412].includes(e.status))
        setTarget(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={prepare}>
        Удалить
      </button>
      {target ? (
        <Confirm
          title="Удалить публикацию?"
          action="Удалить"
          busy={busy}
          cancel={() => {
            setTarget(undefined);
            setError("");
          }}
          submit={remove}
        >
          <p>
            «{target.article.title}» исчезнет из каталога. Восстановить статью
            будет нельзя.
          </p>
          {error && <ErrorNotice message={error} />}
        </Confirm>
      ) : (
        error && <ErrorNotice message={error} />
      )}
    </>
  );
}
export function Workspace({ session }: { session: Session }) {
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const list = useData<Listing>(
    `/api/publications?author_id=${session.user.id}&page=${page}`,
  );
  return (
    <section className="work-page">
      <p className="workspace-byline">
        Рабочий раздел · {session.user.display_name}
      </p>
      <div className="work-heading">
        <h1>Мои публикации</h1>
        <a className="primary" href="/workspace/new">
          Создать материал
        </a>
      </div>
      <a href={"/?author_id=" + session.user.id + "#materials"}>
        Мои материалы в каталоге →
      </a>
      {notice && (
        <p className="write-success" role="status">
          {notice}
        </p>
      )}
      {list.loading ? (
        <p role="status">Загружаем публикации…</p>
      ) : list.error ? (
        <ErrorNotice message={list.error} retry={list.retry} />
      ) : (
        list.data && (
          <>
            {list.data.items.length === 0 ? (
              <div className="work-empty">
                Здесь появятся ваши опубликованные материалы.
              </div>
            ) : (
              <ul className="work-list">
                {list.data.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.subtopic.name}</span>
                    <h2>
                      <a href={"/publications/" + item.id}>{item.title}</a>
                    </h2>
                    <p>Обновлено {date(item.updated_at)}</p>
                    <div className="author-actions">
                      <a href={`/workspace/publications/${item.id}/edit`}>
                        Редактировать
                      </a>
                      <DeletePublication
                        item={item}
                        session={session}
                        done={() => {
                          setNotice("Статья удалена.");
                          if (page > 1 && list.data?.items.length === 1)
                            setPage(page - 1);
                          else list.retry();
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {list.data.total_pages > 1 && (
              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ← Назад
                </button>
                {page} / {list.data.total_pages}
                <button
                  disabled={page >= list.data.total_pages}
                  onClick={() => setPage(page + 1)}
                >
                  Далее →
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
