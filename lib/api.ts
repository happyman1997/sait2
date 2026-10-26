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

// Своё действие по заказу (найм, отказ, сдача, приёмка, отзыв…) меняет «Сейчас важно» и цифры на вкладках, а события
// об этом сервер шлёт второй стороне, не самому действующему, — сообщаем Live.tsx, пусть перечитает. Чат и фото — не то.
export const TODO_EVENT = 'arena:todo';
const JOB_ACTION = /^\/api\/jobs\/\d+\/(?!chat|photos)/;

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
  if (body !== undefined && JOB_ACTION.test(url) && typeof window !== 'undefined') window.dispatchEvent(new Event(TODO_EVENT));
  return data as T;
}
