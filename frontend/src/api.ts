export type Named = { id: number; name: string };
export type Author = { id: string; display_name: string };
export type Subtopic = Named & { direction_id: number };
export type Session = {
  user: Author & { login: string };
  csrf_token: string;
  expires_at: string;
};
export type Publication = {
  id: string;
  title: string;
  markdown?: string;
  author: Author;
  direction: Named;
  subtopic: Named;
  updated_at: string;
  revision_key?: string;
};
export type Listing = {
  items: Publication[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorMessage(status: number, code?: string): string {
  const messages: Record<string, string> = {
    bad_request: "Проверьте заполнение полей и параметры запроса.",
    validation_failed: "Проверьте заполнение полей.",
    invalid_credentials: "Неверный логин или пароль.",
    unauthenticated: "Войдите в аккаунт, чтобы продолжить.",
    csrf_failed: "Обновите страницу и повторите действие.",
    origin_invalid:
      "Откройте сайт по его основному адресу и повторите действие.",
    forbidden: "У вас нет доступа к этому действию.",
    stale_publication: "Статья уже изменена. Откройте её свежую версию.",
    rate_limited: "Слишком много попыток. Подождите немного и повторите.",
    not_found: "Запрошенный материал не найден.",
  };
  return (
    (code && messages[code]) ||
    (status >= 500
      ? "Сервис временно недоступен. Попробуйте ещё раз позже."
      : "Не удалось выполнить действие. Обновите страницу и попробуйте снова.")
  );
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new APIError(
      response.status,
      errorMessage(response.status, body?.error?.code),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
