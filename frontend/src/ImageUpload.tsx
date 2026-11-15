import { useState } from "react";
import { api, APIError, type Session } from "./api";
import { ErrorNotice } from "./shared";
import { Confirm } from "./Workspace";

export function ImageUpload({
  session,
  cancel,
  insert,
}: {
  session: Session;
  cancel: () => void;
  insert: (text: string) => void;
}) {
  const [pending, setPending] = useState<{ file: File; id: string }>();
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    if (!pending) {
      setError("Выберите файл изображения.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("upload_id", pending.id);
      form.set("file", pending.file);
      const { url } = await api<{ url: string }>("/api/media", {
        method: "POST",
        headers: { "X-CSRF-Token": session.csrf_token },
        body: form,
      });
      const label = (alt.trim() || "Изображение").replace(
        /[\\\[\]`*_<>!]/g,
        "\\$&",
      );
      insert(`![${label}](${url})`);
    } catch (e) {
      if (
        e instanceof APIError &&
        (e.status === 404 ||
          e.code === "media_unavailable" ||
          e.code === "idempotency_conflict")
      )
        setPending({ file: pending.file, id: crypto.randomUUID() });
      setError(
        e instanceof APIError && e.status === 429
          ? "Достигнут лимит временных загрузок. Используйте уже загруженное изображение или попробуйте позже."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Confirm
      title="Добавить изображение"
      action="Вставить изображение"
      busy={busy}
      cancel={cancel}
      submit={upload}
    >
      <p>PNG, JPEG или WebP · до 5 МиБ и 20 мегапикселей</p>
      <label>
        Файл изображения
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setError("");
            setPending(undefined);
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
              setError("Размер изображения превышает 5 МиБ.");
              return;
            }
            setPending({ file, id: crypto.randomUUID() });
          }}
        />
      </label>
      <label>
        Описание изображения
        <input
          value={alt}
          disabled={busy}
          onChange={(e) => setAlt(e.target.value)}
        />
      </label>
      {busy && <p role="status">Загружаем изображение…</p>}
      {error && <ErrorNotice message={error} />}
    </Confirm>
  );
}
