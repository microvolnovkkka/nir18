import { useState, useEffect } from "react";
import { api } from "./api";
export const topicLabel = (name: string) => name.trim().replace(/[.。]+$/, "");

export const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export function ErrorNotice({
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
// Через переход страницы передаём только результат действия, без текста статьи.
const noticeKey = "publication-outcome";
export function openAfterWrite(path: string, message: string) {
  try {
    sessionStorage.setItem(noticeKey, JSON.stringify({ path, message }));
  } catch {
    // Переход работает и при отключённом хранилище браузера.
  }
  location.assign(path);
}
export function WriteNotice() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(noticeKey);
      if (!saved) return;
      sessionStorage.removeItem(noticeKey);
      const { path, message } = JSON.parse(saved);
      if (location.pathname === path && typeof message === "string")
        setNotice(message);
    } catch {
      // Уведомление необязательно для просмотра статьи.
    }
  }, []);
  return notice ? (
    <p className="write-success" role="status">
      {notice}
    </p>
  ) : null;
}
export function useData<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(url, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
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
