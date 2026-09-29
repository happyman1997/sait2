// Веб-пуш (Service Worker): подписки браузеров и отправка через протокол Web Push с ключами VAPID.
import webpush from 'web-push';
import { config } from './config';
import { query } from './db';
import { AppError } from './errors';
import type { SessionUser } from './session';

export type PushMessage = { title: string; body: string; url: string };
/** Отправка на одну подписку. Возвращает false, если подписка больше не действует (404/410). */
export type PushSender = (sub: { endpoint: string; p256dh: string; auth: string }, msg: PushMessage) => Promise<boolean>;

const vapidSender: PushSender = async (sub, msg) => {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), {
      vapidDetails: { subject: config.vapidSubject(), publicKey: config.vapidPublic(), privateKey: config.vapidPrivate() },
      TTL: 6 * 3600, timeout: 8000
    });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return false;
    throw e;
  }
};

let sender: PushSender | null = null;
export function setPushSender(s: PushSender | null) { sender = s; }

export function pushEnabled() { return !!sender || !!(config.vapidPublic() && config.vapidPrivate()); }
export function pushPublicKey() { return pushEnabled() ? config.vapidPublic() || 'test' : null; }

type U = Pick<SessionUser, 'id'>;
const need = (u: U | null) => { if (!u) throw new AppError(401, 'Нужно войти в аккаунт.'); return u; };

export async function subscribePush(viewer: U | null, raw: unknown) {
  const u = need(viewer);
  if (!pushEnabled()) throw new AppError(503, 'Пуш-уведомления на сервере не настроены.');
  const r = (raw && typeof raw === 'object' ? raw : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof r.endpoint === 'string' ? r.endpoint : '';
  const p256dh = typeof r.keys?.p256dh === 'string' ? r.keys.p256dh : '';
  const auth = typeof r.keys?.auth === 'string' ? r.keys.auth : '';
  // Только https-адреса пуш-сервисов браузеров — сервер не должен ходить по произвольным адресам.
  if (!/^https:\/\/[^\s]{10,500}$/.test(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) {
    throw new AppError(422, 'Браузер прислал неполную подписку — попробуйте ещё раз.');
  }
  const host = new URL(endpoint).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new AppError(422, 'Недопустимый адрес подписки.');
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`, [u.id, endpoint, p256dh, auth]);
  // Не больше 10 устройств: старые подписки уходят.
  await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10)`, [u.id]);
  return { ok: true };
}

export async function unsubscribePush(viewer: U | null, endpoint: unknown) {
  const u = need(viewer);
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [u.id, typeof endpoint === 'string' ? endpoint : '']);
  return { ok: true };
}

/** Доставка одного сообщения на все устройства пользователя. Бросает, если ни одно не приняло из-за сбоя. */
export async function deliverPush(userId: string, msg: PushMessage): Promise<number> {
  const subs = await query<{ id: string; endpoint: string; p256dh: string; auth: string }>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  const send = sender ?? vapidSender;
  let ok = 0, failed = 0;
  for (const s of subs.rows) {
    try {
      if (await send(s, msg)) ok++;
      else await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
    } catch { failed++; }
  }
  if (!ok && failed) throw new Error('push failed');
  return ok;
}
