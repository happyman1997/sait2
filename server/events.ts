// Журнал событий пользователя, мгновенное уведомление (live) и доставка во внешние каналы (SMS, e-mail).
import { config } from './config';
import { one, pool, query, type Db } from './db';
import { publish } from './live';
import { getMailer } from './mail';
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
};

type Settings = {
  enabled: boolean; sms: boolean; email: boolean; quiet_on: boolean; quiet_from: number; quiet_to: number;
  urgent_bypass: boolean; daily_cap: number; phone: string; addr: string;
};

/** Час и начало суток в часовом поясе площадки. */
export function localClock(now = new Date(), tz = config.timeZone()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  return { hour: parseInt(parts.hour, 10), day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function inQuiet(hour: number, from: number, to: number) {
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Когда закончатся тихие часы (в минутах от сейчас). */
function minutesUntilQuietEnds(hour: number, to: number) {
  return (((to - hour) + 24) % 24 || 24) * 60;
}

async function enqueue(r: EventRow, eventId: string, db: Db) {
  const s = await one<Settings>(
    `SELECT ns.enabled, ns.sms, ns.email, ns.quiet_on, ns.quiet_from, ns.quiet_to, ns.urgent_bypass, ns.daily_cap, u.phone, u.email AS addr
       FROM users u JOIN notification_settings ns ON ns.user_id = u.id WHERE u.id = $1`, [r.userId], db);
  if (!s || !s.enabled || (!s.sms && !s.email)) return;
  // Суточный лимит: остальное копится в журнале.
  const sentToday = (await one<{ n: number }>(
    `SELECT count(DISTINCT event_id)::int AS n FROM notification_outbox WHERE user_id = $1 AND created_at > now() - interval '24 hours' AND status <> 'skipped'`,
    [r.userId], db))!.n;
  if (sentToday >= s.daily_cap) {
    await query('UPDATE events SET muted = true WHERE id = $1', [eventId], db);
    return;
  }
  const { hour } = localClock();
  const delayMin = s.quiet_on && inQuiet(hour, s.quiet_from, s.quiet_to) && !(r.urgent && s.urgent_bypass)
    ? minutesUntilQuietEnds(hour, s.quiet_to) : 0;
  const link = r.num ? '\n' + config.publicUrl() + '/?job=' + r.num : '';
  if (s.sms) {
    await query(`INSERT INTO notification_outbox (user_id, event_id, channel, to_addr, body, next_try_at) VALUES ($1, $2, 'sms', $3, $4, now() + make_interval(mins => $5))`,
      [r.userId, eventId, s.phone, ('Арена Работы: ' + r.text).slice(0, 300), delayMin], db);
  }
  if (s.email && s.addr) {
    await query(`INSERT INTO notification_outbox (user_id, event_id, channel, to_addr, subject, body, next_try_at) VALUES ($1, $2, 'email', $3, $4, $5, now() + make_interval(mins => $6))`,
      [r.userId, eventId, s.addr, 'Арена Работы: ' + r.text.slice(0, 80), r.text + link + '\n\nНастроить уведомления: ' + config.publicUrl() + '/profile', delayMin], db);
  }
}

export async function addEvents(rows: EventRow[], db: Db = pool()) {
  for (const r of rows) {
    if (!r.userId) continue;
    const ev = await one<{ id: string }>(// Свои действия (silent) сразу прочитаны — в счётчик журнала не попадают.
      `INSERT INTO events (user_id, kind, text, job_id, urgent, read_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END) RETURNING id`,
      [r.userId, r.kind, r.text, r.jobId ?? null, !!r.urgent, !!r.silent], db);
    if (!r.silent) await publish([r.userId], { t: 'event', text: r.text, num: r.num ?? null }, db);
    if (r.deliver) await enqueue(r, ev!.id, db);
  }
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
  const due = await query<{ id: string; channel: 'sms' | 'email'; to_addr: string; subject: string | null; body: string; attempts: number }>(
    `UPDATE notification_outbox o SET next_try_at = now() + interval '10 minutes'
      WHERE o.id IN (SELECT id FROM notification_outbox WHERE status = 'pending' AND next_try_at <= now()
                      ORDER BY next_try_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.channel, o.to_addr, o.subject, o.body, o.attempts`, [limit]);
  let sent = 0, failed = 0;
  for (const m of due.rows) {
    try {
      if (m.channel === 'sms') await codeSender().sendText(m.to_addr, m.body);
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
