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

export async function api<T = unknown>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { message: 'Нет связи с сервером — проверьте интернет и повторите.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || { message: 'Ошибка сервера — попробуйте ещё раз.' });
  return data as T;
}
