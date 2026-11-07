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
      body?.error?.message || `Сервис ответил с ошибкой ${response.status}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
