// Журнал событий пользователя, мгновенное уведомление (live) и доставка во внешние каналы (SMS, e-mail).
import crypto from 'node:crypto';
import { config } from './config';
import { pool, query, type Db } from './db';
import { publishMany } from './live';
import { getMailer } from './mail';
import { deliverPush } from './push';
import { codeSender } from './sms';

export type EventRow = {
  userId: string | null | undefined;
  kind: string;
  text: string;
  jobId?: string | null;
  num?: number | null;
  /** Не показывать живым уведомлением (событие от своего же действия — тост уже показан). */
  silent?: boolean;
  /** Доставить по SMS/e-mail по настройкам пользователя. */
  deliver?: boolean;
  /** Срочное — проходит тихие часы, если пользователь разрешил. */
  urgent?: boolean;
  /** Куда ведёт ссылка в письме и пуше (по умолчанию — карточка заказа). */
  path?: string;
};

/** Час и минута в часовом поясе площадки. */
export function localClock(now = new Date(), tz = config.timeZone()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  return { hour: parseInt(parts.hour, 10), minute: parseInt(parts.minute, 10), day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function inQuiet(hour: number, from: number, to: number) {
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Постановка в очередь одним запросом на всю пачку (новая смена рядом — до 500 получателей).
 * Лимит в сутки: уже отправленное за 24 ч + порядковый номер события в пачке; сверх лимита — «без доставки».
 * Тихие часы: отправка сдвигается на их конец (срочное — сразу, если пользователь разрешил).
 */
async function enqueue(rows: { id: string; userId: string; text: string; num: number | null; urgent: boolean; path: string | null }[], db: Db) {
  if (!rows.length) return;
  const { hour, minute } = localClock();
  const url = config.publicUrl();
  await query(
    `WITH ev AS (
       SELECT x.*, coalesce(x.path, '/?job=' || x.num) AS link
         FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::bigint[], $5::bool[], $9::text[]) WITH ORDINALITY AS x(id, user_id, text, num, urgent, path, ord)
     ), s0 AS (
       SELECT ev.*, ns.sms, ns.email AND u.email_verified_at IS NOT NULL AS email, ns.daily_cap, u.phone, u.email AS addr,
              ns.push AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = ev.user_id) AS webpush,
              ns.quiet_on AND NOT (ev.urgent AND ns.urgent_bypass) AND CASE
                WHEN ns.quiet_from = ns.quiet_to THEN false
                WHEN ns.quiet_from < ns.quiet_to THEN $6 >= ns.quiet_from AND $6 < ns.quiet_to
                ELSE $6 >= ns.quiet_from OR $6 < ns.quiet_to END AS quiet,
              ns.quiet_to,
              (SELECT count(DISTINCT o.event_id) FROM notification_outbox o
                WHERE o.user_id = ev.user_id AND o.created_at > now() - interval '24 hours' AND o.status <> 'skipped')
                + row_number() OVER (PARTITION BY ev.user_id ORDER BY ev.ord) AS nth
         FROM ev JOIN users u ON u.id = ev.user_id JOIN notification_settings ns ON ns.user_id = ev.user_id
        WHERE ns.enabled
     ), s AS (
       SELECT * FROM s0 WHERE sms OR email OR webpush
     ), muted AS (
       UPDATE events SET muted = true WHERE id IN (SELECT id FROM s WHERE nth > daily_cap) RETURNING id
     ), ok AS (
       SELECT *, now() + make_interval(mins => CASE WHEN quiet THEN coalesce(nullif((quiet_to - $6 + 24) % 24, 0), 24) * 60 - $7 ELSE 0 END) AS at
         FROM s WHERE nth <= daily_cap
     )
     INSERT INTO notification_outbox (user_id, event_id, channel, to_addr, subject, body, next_try_at)
     SELECT user_id, id, 'sms', phone, NULL, left('Арена Работы: ' || text, 300), at FROM ok WHERE sms
     UNION ALL
     SELECT user_id, id, 'email', addr, 'Арена Работы: ' || left(text, 80),
            text || CASE WHEN link IS NULL THEN '' ELSE E'\n' || $8 || link END || E'\n\nНастроить уведомления: ' || $8 || '/profile', at
       FROM ok WHERE email AND addr <> ''
     UNION ALL
     SELECT user_id, id, 'push', 'push', coalesce(link, '/'), left(text, 300), at FROM ok WHERE webpush`,
    [rows.map(r => r.id), rows.map(r => r.userId), rows.map(r => r.text), rows.map(r => r.num), rows.map(r => r.urgent), hour, minute, url, rows.map(r => r.path)], db);
}

/** Запись событий пачкой: журнал, живое уведомление, очередь доставки. Константное число запросов на любую пачку. */
export async function addEvents(rows: EventRow[], db: Db = pool()) {
  const list = rows.filter((r): r is EventRow & { userId: string } => !!r.userId).map(r => ({ ...r, id: crypto.randomUUID() }));
  if (!list.length) return;
  // Свои действия (silent) сразу прочитаны — в счётчик журнала не попадают.
  await query(
    `INSERT INTO events (id, user_id, kind, text, job_id, urgent, read_at)
     SELECT id, u, k, t, j, g, CASE WHEN s THEN now() END
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::uuid[], $6::bool[], $7::bool[]) AS x(id, u, k, t, j, g, s)`,
    [list.map(r => r.id), list.map(r => r.userId), list.map(r => r.kind), list.map(r => r.text), list.map(r => r.jobId ?? null), list.map(r => !!r.urgent), list.map(r => !!r.silent)], db);
  await publishMany(list.filter(r => !r.silent).map(r => ({ userIds: [r.userId], e: { t: 'event' as const, text: r.text, num: r.num ?? null } })), db);
  await enqueue(list.filter(r => r.deliver).map(r => ({ id: r.id, userId: r.userId, text: r.text, num: r.num ?? null, urgent: !!r.urgent, path: r.path ?? null })), db);
}

/** Письмо в поддержку (жалобы). */
export async function mailSupport(subject: string, body: string, db: Db = pool()) {
  await query(`INSERT INTO notification_outbox (channel, to_addr, subject, body) VALUES ('email', $1, $2, $3)`, [config.supportEmail(), subject, body], db);
}

/**
 * Отправка очереди. Записи сначала «арендуются» (next_try_at сдвигается на 10 минут) коротким запросом с SKIP LOCKED —
 * несколько инстансов не шлют одно и то же, а медленный SMS-шлюз не держит транзакцию открытой.
 * Если процесс упадёт посреди отправки, аренда истечёт и запись уйдёт повторно.
 */
export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number }> {
  const due = await query<{ id: string; user_id: string | null; channel: 'sms' | 'email' | 'push'; to_addr: string; subject: string | null; body: string; attempts: number }>(
    `UPDATE notification_outbox o SET next_try_at = now() + interval '10 minutes'
      WHERE o.id IN (SELECT id FROM notification_outbox WHERE status = 'pending' AND next_try_at <= now()
                      ORDER BY next_try_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.user_id, o.channel, o.to_addr, o.subject, o.body, o.attempts`, [limit]);
  let sent = 0, failed = 0;
  for (const m of due.rows) {
    try {
      if (m.channel === 'sms') await codeSender().sendText(m.to_addr, m.body);
      else if (m.channel === 'push') await deliverPush(m.user_id!, { title: 'Арена Работы', body: m.body, url: m.subject || '/' });
      else await getMailer().send(m.to_addr, m.subject || 'Арена Работы', m.body);
      await query(`UPDATE notification_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1`, [m.id]);
      sent++;
    } catch (e) {
      const give = m.attempts + 1 >= 5;
      await query(
        `UPDATE notification_outbox SET attempts = attempts + 1, error = $2, status = $3, next_try_at = now() + make_interval(mins => $4) WHERE id = $1`,
        [m.id, String((e as Error).message).slice(0, 300), give ? 'failed' : 'pending', 2 ** (m.attempts + 1)]);
      failed++;
    }
  }
  return { sent, failed };
}
