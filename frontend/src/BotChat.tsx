import { useEffect, useRef, useState } from "react";
import { api, APIError } from "./api";
import { Markdown } from "./Markdown";
import { Confirm } from "./Workspace";
import {
  botContext,
  checkReply,
  prepareReport,
  type BotReply,
} from "./botReport";

export type EditorTab = "chat" | "edit" | "preview";
type Exchange = { message: string; snapshot: string; reply: BotReply };
type Proposal = ReturnType<typeof prepareReport> & {
  exchange: Exchange;
  base: string;
};
type Props = {
  tab: EditorTab;
  csrf: string;
  title: string;
  subtopic: string;
  body: string;
  validateTopic: () => boolean;
  openEditor: () => void;
  apply: (value: string) => void;
  onDirty: (value: boolean) => void;
};
function generationError(error: unknown) {
  if (error instanceof SyntaxError)
    return "Сервис вернул нечитаемый ответ. Повторите запрос.";
  if (
    error instanceof APIError &&
    (error.status === 401 || error.code === "csrf_failed")
  )
    return "Войдите в исходный аккаунт в другой вкладке и вернитесь к сообщению.";
  if (!(error instanceof APIError))
    return error instanceof Error
      ? error.message
      : "Не удалось получить ответ.";
  if (error.code === "bot_media_mismatch")
    return "Бот изменил ссылки на изображения. Ваш текст сохранён в редакторе. Повторите запрос.";
  if (error.code === "media_context_invalid")
    return "Проверьте ссылки на изображения в редакторе. Используйте собственные файлы, загруженные через «Добавить изображение», и Markdown без HTML.";
  if (error.code === "contract_version_unsupported")
    return "Версии сайта и бота различаются. Скопируйте свою работу перед обновлением страницы.";
  const messages: Record<number, string> = {
    409: "Для этого аккаунта уже готовится ответ. Дождитесь его и повторите отправку.",
    413: "Материал слишком велик для одного запроса. Сократите сообщение или текст редактора.",
    422: "Проверьте тему, подтему и объём переданного текста.",
    429: "Достигнут лимит запросов. Повторите отправку позже.",
    502: "Бот вернул некорректный ответ. Попробуйте ещё раз.",
    503: "Сервис генерации сейчас недоступен. Можно продолжить работу в редакторе.",
    504: "Бот не успел ответить. Можно повторить отправку.",
  };
  return messages[error.status] || error.message;
}
export function BotChat({
  tab,
  csrf,
  title,
  subtopic,
  body,
  validateTopic,
  openEditor,
  apply,
  onDirty,
}: Props) {
  const [message, setMessage] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [reset, setReset] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalNotice, setProposalNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const dirty = Boolean(message || exchanges.length || pending);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (tab === "chat" && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [exchanges, tab]);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setTimeout(
      () => setWaitUntil(0),
      Math.max(0, waitUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [waitUntil]);

  async function send() {
    if (active.current || waitUntil > Date.now()) return;
    setError("");
    setLoginNeeded(false);
    setStatus("");
    if (!validateTopic()) return;
    if (!message.trim() || [...message].length > 20000) {
      setError("Введите сообщение длиной от 1 до 20 000 символов.");
      input.current?.focus();
      return;
    }
    const history = exchanges.flatMap(({ message, reply }) => [
      { role: "user", content: message },
      { role: "assistant", content: reply.markdown },
    ]);
    const lengths = history.map((m) => [...m.content].length);
    if (
      history.length > 20 ||
      lengths.some((n) => n > 20000) ||
      lengths.reduce((a, b) => a + b, 0) > 80000
    ) {
      setError(
        "Достигнут предел истории. Начните новый диалог, чтобы отправить это сообщение. Текст редактора сохранится.",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 100000);
    try {
      const current = botContext(body);
      if ([...current].length > 200000)
        throw new Error("Сократите текст редактора до 200 000 символов.");
      const id = crypto.randomUUID();
      const payload = JSON.stringify({
        contract_version: "1.0",
        request_id: id,
        topic: { title: title.trim(), subtopic_id: Number(subtopic) },
        message,
        history,
        current_markdown: current,
      });
      if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024)
        throw new Error("Уменьшите объём материала для отправки.");
      setPending(true);
      const result = await api<unknown>("/api/bot/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: payload,
        signal: controller.signal,
      });
      if (active.current !== controller || controller.signal.aborted) return;
      const reply = checkReply(result, id, current);
      setExchanges((old) => [...old, { message, snapshot: body, reply }]);
      setMessage("");
      setRetry(false);
      setStatus(
        reply.kind === "report"
          ? "Отчёт готов."
          : "Бот задал уточняющий вопрос.",
      );
    } catch (e) {
      if (active.current !== controller) return;
      const seconds = e instanceof APIError ? e.retryAfter : 0;
      if (seconds > 0) setWaitUntil(Date.now() + seconds * 1000);
      setError(
        timedOut
          ? "Время ожидания истекло. Можно повторить отправку."
          : generationError(e),
      );
      setLoginNeeded(
        e instanceof APIError && (e.status === 401 || e.code === "csrf_failed"),
      );
      setRetry(true);
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setRetry(true);
    setStatus("Запрос отменён. Можно изменить сообщение и отправить снова.");
  }
  function offer(exchange: Exchange, reviewing = false) {
    try {
      const prepared = prepareReport(exchange.reply.markdown, body);
      openEditor();
      setError("");
      if (!reviewing && !body && !exchange.snapshot) {
        setProposal(null);
        setProposalNotice("");
        apply(prepared.markdown);
      } else {
        setProposal({ ...prepared, exchange, base: body });
        setProposalNotice(
          reviewing
            ? "Редактор снова изменился. Проверьте обновлённый вариант перед применением."
            : "",
        );
      }
    } catch (e) {
      if (reviewing) {
        setProposal(null);
        setProposalNotice((e as Error).message);
      } else setError((e as Error).message);
    }
  }
  if (tab === "edit" && proposal) {
    return (
      <section className="bot-proposal" aria-label="Предложение бота">
        <h2>Предложение бота</h2>
        <p>После применения этот текст заменит содержимое редактора.</p>
        {proposal.base !== proposal.exchange.snapshot && (
          <p>
            Ответ подготовлен по более ранней версии текста. Проверьте свои
            последние правки.
          </p>
        )}
        {proposal.moved && (
          <p>
            Состав изображений изменился. Удалённые вставки исключены, текущие
            собраны в конце текста.
          </p>
        )}
        {proposalNotice && <p role="status">{proposalNotice}</p>}
        <div className="proposal-text">
          <Markdown text={proposal.markdown} />
        </div>
        <div className="work-actions">
          <button
            className="primary"
            onClick={() => {
              if (body !== proposal.base) {
                offer(proposal.exchange, true);
                return;
              }
              apply(proposal.markdown);
              setProposal(null);
              setProposalNotice("");
            }}
          >
            Применить
          </button>
          <button
            className="secondary-action"
            onClick={() => {
              setProposal(null);
              setProposalNotice("");
            }}
          >
            Оставить свой текст
          </button>
        </div>
      </section>
    );
  }
  if (tab !== "chat")
    return tab === "edit" && proposalNotice ? (
      <p role="alert">{proposalNotice}</p>
    ) : null;
  return (
    <section className="bot-chat" aria-label="Диалог с ботом">
      <div className="bot-chat-heading">
        <h2>Диалог</h2>
        {exchanges.length > 0 && (
          <button
            className="secondary-action"
            disabled={pending}
            onClick={() => setReset(true)}
          >
            Новый диалог
          </button>
        )}
      </div>
      {exchanges.length > 0 ? (
        <ol
          ref={log}
          className="bot-log"
          tabIndex={0}
          aria-label="История диалога"
        >
          {exchanges.map(({ message, reply }, i) => (
            <li key={reply.request_id}>
              <div className="bot-question">
                <strong>Вы</strong>
                <p>{message}</p>
              </div>
              <div className="bot-answer">
                <strong>
                  {reply.kind === "report" ? "Отчёт" : "Уточнение"} ·{" "}
                  {reply.mode === "stub" ? "Тестовая заглушка" : "ИИ-бот"}
                </strong>
                <Markdown text={reply.markdown} />
                {reply.warnings.length > 0 && (
                  <ul className="bot-warnings" aria-label="Предупреждения">
                    {reply.warnings.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                )}
                {reply.kind === "report" && (
                  <button
                    className="secondary-action"
                    onClick={() => offer(exchanges[i])}
                  >
                    Сформировать черновик
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="bot-hint">
          Вставьте тезисы, наблюдения или фрагменты источников. Ссылки служат
          указанием на источник. Изображения можно добавить в редакторе.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="bot-message">Сообщение</label>
        <textarea
          ref={input}
          id="bot-message"
          rows={4}
          readOnly={pending}
          value={message}
          placeholder="Какой материал подготовим?"
          onChange={(e) => {
            setMessage(e.target.value);
            setError("");
            setStatus("");
            setRetry(false);
          }}
        />
        {error && (
          <div className="notice" role="alert">
            {error}{" "}
            {loginNeeded && (
              <a href="/login" target="_blank" rel="noopener">
                Войти снова в другой вкладке
              </a>
            )}
          </div>
        )}
        <div role="status">
          {pending ? (
            <span className="bot-wait">Бот готовит ответ…</span>
          ) : waitUntil ? (
            "Следующая отправка доступна в " +
            new Date(waitUntil).toLocaleTimeString("ru-RU") +
            "."
          ) : (
            status
          )}
        </div>
        <div className="work-actions">
          <button
            type="submit"
            className="primary"
            disabled={pending || !!waitUntil}
          >
            {retry ? "Повторить" : "Отправить"}
          </button>
          {pending && (
            <button type="button" className="secondary-action" onClick={cancel}>
              Отменить
            </button>
          )}
        </div>
      </form>
      {reset && (
        <Confirm
          title="Начать новый диалог?"
          action="Начать"
          busy={false}
          cancel={() => setReset(false)}
          submit={() => {
            setExchanges([]);
            setProposal(null);
            setProposalNotice("");
            setStatus("");
            setError("");
            setRetry(false);
            setReset(false);
          }}
        >
          <p>
            История ответов очистится. Текст редактора и набранное сообщение
            сохранятся.
          </p>
        </Confirm>
      )}
    </section>
  );
}
