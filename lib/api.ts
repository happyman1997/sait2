import type { BadCategory } from './moderation';

export type ApiErrorBody = {
  message: string;
  field?: string;
  moderation?: { label: string; category: BadCategory };
  attemptsLeft?: number;
  retryAfter?: number;
};

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
  get field() { return this.body.field; }
}

/** JSON-запрос; FormData уходит как multipart (загрузка фото). DELETE без тела — передайте body = null. */
export async function api<T = unknown>(url: string, body?: unknown, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined
      ? { credentials: 'same-origin' }
      : body === null
        ? { method, credentials: 'same-origin' }
        : body instanceof FormData
          ? { method, credentials: 'same-origin', body }
          : { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { message: 'Нет связи с сервером — проверьте интернет и повторите.' });
  }
  // Успех засчитываем только по JSON-ответу: HTML-страница (прокси, перезапуск сервера) — не подтверждение действия.
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || { message: 'Ошибка сервера — попробуйте ещё раз.' });
  if (data === null) throw new ApiError(res.status, { message: 'Сервер ответил неожиданно — обновите страницу и проверьте, сохранилось ли действие.' });
  return data as T;
}
