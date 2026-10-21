// Ежедневная сводка владельцу на почту (deploy/digest.sh → scripts/digest.ts): что было на площадке за сутки и что
// требует внимания — жалобы и споры без решения, недоставленные письма, а от сервера — копии, место на диске,
// сертификат, ответ сайта. Сервер присылает свои проверки строками «ключ=значение» на stdin (parseHostFacts).
import { plural } from '@/lib/jobs';
import { config } from './config';
import { one, pool, type Db } from './db';
import { slaDeadline } from './support';

export type HostFacts = {
  dir?: string;              // папка сайта на сервере — для команд в письме
  diskUsed?: number;         // % занятого места
  diskAvailGb?: number;
  backupLast?: string;       // имя последней копии базы
  backupAgeH?: number;
  backupSize?: string;
  backupOffsite?: boolean;   // копии уходят в хранилище
  backupErrors: string[];    // строки с ошибками из журнала последней копии
  certDays?: number;
  health?: string;           // код ответа /api/health
  updates?: number;          // ждут установки обновлений безопасности
  reboot?: boolean;
  siteOff?: boolean;         // закрыт кнопкой deploy/site.sh
};

const num = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);

/** Проверки сервера: «ключ=значение» по строке; backup_err — может повторяться. Незнакомое пропускается. */
export function parseHostFacts(text: string): HostFacts {
  const f: HostFacts = { backupErrors: [] };
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (!v) continue;
    switch (k) {
      case 'dir': f.dir = v; break;
      case 'disk_used': f.diskUsed = num(v); break;
      case 'disk_avail_kb': { const n = num(v); if (n != null) f.diskAvailGb = Math.round(n / 1024 / 1024 * 10) / 10; break; }
      case 'backup_last': f.backupLast = v; break;
      case 'backup_age_h': f.backupAgeH = num(v); break;
      case 'backup_size': f.backupSize = v; break;
      case 'backup_offsite': f.backupOffsite = v === '1'; break;
      case 'backup_err': if (f.backupErrors.length < 5) f.backupErrors.push(v.slice(0, 200)); break;
      case 'cert_days': f.certDays = num(v); break;
      case 'health': f.health = v; break;
      case 'updates': f.updates = num(v); break;
      case 'reboot': f.reboot = v === '1'; break;
      case 'site_off': f.siteOff = v === '1'; break;
    }
  }
  return f;
}

export type DigestStats = {
  newFl: number; newEmp: number; fl: number; emp: number; deleted: number;
  newJobs: number; openJobs: number; apps: number; hires: number; done: number; cancelled: number; noShows: number; reviews: number;
  newComplaints: number; openComplaints: number; overdueComplaints: number; oldestComplaint: Date | null;
  newDisputes: number; openDisputes: number; overdueDisputes: number; oldestDispute: Date | null;
  mailFailed: number; stuck: number; staff: number;
};

/** Цифры площадки за сутки до `now` и на сейчас. */
export async function collectStats(now = new Date(), db: Db = pool()): Promise<DigestStats> {
  const since = new Date(now.getTime() - 86400_000);
  const r = await one<Omit<DigestStats, 'overdueComplaints' | 'overdueDisputes'> & { complaintDates: Date[]; disputeDates: Date[] }>(
    `SELECT
       (SELECT count(*) FROM users WHERE created_at >= $1 AND role = 'freelancer')::int AS "newFl",
       (SELECT count(*) FROM users WHERE created_at >= $1 AND role = 'employer')::int AS "newEmp",
       (SELECT count(*) FROM users WHERE status = 'active' AND role = 'freelancer')::int AS fl,
       (SELECT count(*) FROM users WHERE status = 'active' AND role = 'employer')::int AS emp,
       (SELECT count(*) FROM users WHERE deleted_at >= $1)::int AS deleted,
       (SELECT count(*) FROM jobs WHERE created_at >= $1)::int AS "newJobs",
       (SELECT count(*) FROM jobs WHERE status = 'open'
          AND (date >= $2::date OR (repeat IS NOT NULL AND (series_end IS NULL OR series_end >= $2::date))))::int AS "openJobs",
       (SELECT count(*) FROM applications WHERE created_at >= $1)::int AS apps,
       (SELECT count(*) FROM hires WHERE hired_at >= $1)::int AS hires,
       ((SELECT count(*) FROM acceptances WHERE accepted_at >= $1) + (SELECT count(*) FROM series_days WHERE accepted_at >= $1))::int AS done,
       (SELECT count(*) FROM cancellations WHERE at >= $1)::int AS cancelled,
       (SELECT count(*) FROM no_shows WHERE at >= $1)::int AS "noShows",
       (SELECT count(*) FROM reviews WHERE created_at >= $1)::int AS reviews,
       (SELECT count(*) FROM complaints WHERE created_at >= $1)::int AS "newComplaints",
       (SELECT count(*) FROM complaints WHERE status = 'open')::int AS "openComplaints",
       (SELECT min(created_at) FROM complaints WHERE status = 'open') AS "oldestComplaint",
       (SELECT coalesce(array_agg(created_at), '{}') FROM complaints WHERE status = 'open') AS "complaintDates",
       (SELECT count(*) FROM disputes WHERE created_at >= $1)::int AS "newDisputes",
       (SELECT count(*) FROM disputes WHERE status IN ('open', 'review'))::int AS "openDisputes",
       (SELECT min(created_at) FROM disputes WHERE status IN ('open', 'review')) AS "oldestDispute",
       (SELECT coalesce(array_agg(created_at), '{}') FROM disputes WHERE status IN ('open', 'review')) AS "disputeDates",
       (SELECT count(*) FROM notification_outbox WHERE channel = 'email' AND status = 'failed' AND created_at >= $1)::int AS "mailFailed",
       (SELECT count(*) FROM notification_outbox WHERE status = 'pending' AND created_at < $3::timestamptz - interval '30 minutes')::int AS stuck,
       (SELECT count(*) FROM users WHERE is_staff AND status = 'active')::int AS staff`,
    [since, localDay(now), now], db);
  const s = r!;
  const overdue = (dates: Date[]) => dates.filter(d => slaDeadline(new Date(d)) < now).length;
  const { complaintDates, disputeDates, ...rest } = s;
  return { ...rest, overdueComplaints: overdue(complaintDates), overdueDisputes: overdue(disputeDates) };
}

const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone() }).format(d);
const dayMonth = (d: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone(), day: 'numeric', month: 'long' }).format(d);
const hm = (d: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone(), hour: '2-digit', minute: '2-digit' }).format(d);
const days = (n: number) => n + ' ' + plural(n, 'день', 'дня', 'дней');
const ago = (h: number) => (h < 48 ? Math.round(h) + ' ч назад' : days(Math.floor(h / 24)) + ' назад');
const age = (from: Date, now: Date) => {
  const n = Math.floor((now.getTime() - new Date(from).getTime()) / 86400_000);
  return n < 1 ? 'меньше суток' : days(n);
};

/** Письмо: тема, текст и сколько пунктов требует внимания (0 — всё в порядке). */
export function composeDigest(s: DigestStats, host: HostFacts | null, now = new Date()) {
  const dir = host?.dir || '/opt/arena';
  const site = config.publicUrl().replace(/\/$/, '');
  const urgent: string[] = [];
  const notes: string[] = [];

  if (host) {
    if (!host.backupLast) urgent.push(`Резервных копий базы нет. Сделать сейчас: cd ${dir} && sh deploy/backup.sh`);
    else if ((host.backupAgeH ?? 0) > 26) urgent.push(`Резервная копия не сделана: последняя — ${ago(host.backupAgeH!)}. Журнал: tail ${dir}/deploy/backups/backup.log`);
    if (host.backupErrors.length) urgent.push('Ошибка при последней резервной копии: ' + host.backupErrors.join(' / '));
    if (host.diskUsed != null && host.diskUsed >= 90) urgent.push(`Диск почти заполнен: занято ${host.diskUsed}%. Когда место кончится, сайт перестанет сохранять данные. Напишите разработчику.`);
    else if (host.diskUsed != null && host.diskUsed >= 80) notes.push(`На диске занято ${host.diskUsed}% — пора посмотреть, что занимает место.`);
    if (host.certDays != null && host.certDays < 14) urgent.push(`Сертификат сайта истекает через ${days(host.certDays)} — после этого браузеры покажут «небезопасно». Продлить: cd ${dir} && bash deploy/launch.sh`);
    else if (host.certDays != null && host.certDays < 25) notes.push(`Сертификат действует ещё ${days(host.certDays)} — он должен был продлиться сам. Если через неделю цифра не вырастет: cd ${dir} && bash deploy/launch.sh`);
    if (host.siteOff) notes.push(`Сайт закрыт для посетителей («Сайт временно не работает»). Открыть: cd ${dir} && bash deploy/site.sh on`);
    else if (host.health && host.health !== '200') urgent.push((host.health === '000' ? 'Сайт не отвечает' : `Сайт ответил с ошибкой (код ${host.health})`) +
      `. Перезапустить: cd ${dir} && bash deploy/launch.sh`);
    if (host.backupLast && host.backupOffsite === false) notes.push(`Копии хранятся только на этом сервере — пропадут вместе с ним. Настроить хранилище: bash ${dir}/deploy/backup-setup.sh`);
    if (host.reboot) notes.push('После обновлений системы нужна перезагрузка: reboot — сайт поднимется сам через 1–2 минуты.');
  }
  if (s.mailFailed) urgent.push(`Не доставлено писем-уведомлений: ${s.mailFailed}. Проверить почту сайта: bash ${dir}/deploy/mailcheck.sh`);
  if (s.stuck) urgent.push(`Уведомления не уходят: ${s.stuck} ждут отправки дольше 30 минут. Перезапустить сайт: cd ${dir} && bash deploy/launch.sh`);
  if (s.openComplaints || s.openDisputes) {
    const parts = [
      s.openComplaints ? `жалоб ${s.openComplaints}` + (s.overdueComplaints ? ` (просрочено ${s.overdueComplaints})` : '') : '',
      s.openDisputes ? `споров ${s.openDisputes}` + (s.overdueDisputes ? ` (просрочено ${s.overdueDisputes})` : '') : ''
    ].filter(Boolean);
    const oldest = [s.oldestComplaint, s.oldestDispute].filter((d): d is Date => !!d).sort((a, b) => +new Date(a) - +new Date(b))[0];
    urgent.push(`Ждут решения: ${parts.join(', ')}; самому старому — ${age(oldest, now)}. Срок ответа — 3 рабочих дня. Разобрать: ${site}/support` +
      (s.staff ? '' : `\n  Сотрудников поддержки нет — назначьте себя: cd ${dir} && docker compose -f docker-compose.prod.yml --env-file .env.production exec app node scripts/staff.mjs add <ваш логин>`));
  }

  const lines: string[] = [];
  const since = new Date(now.getTime() - 86400_000);
  lines.push(`Сводка «Арены Работ» за сутки: с ${dayMonth(since)} ${hm(since)} по ${dayMonth(now)} ${hm(now)} (${config.timeZone() === 'Europe/Moscow' ? 'время московское' : config.timeZone()}).`, '');
  lines.push('ТРЕБУЕТ ВНИМАНИЯ');
  if (urgent.length) urgent.forEach(u => lines.push('• ' + u));
  else lines.push('Ничего — всё в порядке.');
  lines.push('', 'ЗА СУТКИ');
  lines.push(`Регистраций: ${s.newFl + s.newEmp}` + (s.newFl + s.newEmp ? ` — исполнителей ${s.newFl}, работодателей ${s.newEmp}` : ''));
  lines.push(`Новых заказов: ${s.newJobs}`);
  lines.push(`Откликов: ${s.apps}, наймов: ${s.hires}`);
  lines.push(`Закрыто смен: ${s.done}, отмен: ${s.cancelled}, «не вышел»: ${s.noShows}`);
  lines.push(`Отзывов: ${s.reviews}, жалоб: ${s.newComplaints}, споров: ${s.newDisputes}`);
  if (s.deleted) lines.push(`Удалили аккаунт: ${s.deleted}`);
  lines.push('', 'СЕЙЧАС');
  lines.push(`Пользователей: ${s.fl + s.emp} — исполнителей ${s.fl}, работодателей ${s.emp}`);
  lines.push(`Заказов в наборе: ${s.openJobs}`);
  lines.push(`Жалоб без решения: ${s.openComplaints}, споров без решения: ${s.openDisputes}`);
  if (host) {
    lines.push('', 'СЕРВЕР');
    if (host.diskUsed != null) lines.push(`Диск: занято ${host.diskUsed}%` + (host.diskAvailGb != null ? `, свободно ${String(host.diskAvailGb).replace('.', ',')} ГБ` : ''));
    if (host.certDays != null) lines.push(`Сертификат: действует ещё ${days(host.certDays)}`);
    if (host.backupLast) lines.push(`Последняя копия: ${host.backupLast}${host.backupSize ? ' (' + host.backupSize + ')' : ''}, ${ago(host.backupAgeH ?? 0)}` +
      (host.backupOffsite ? ', есть в хранилище' : ', только на сервере'));
    if (host.updates) lines.push(`Обновления безопасности: ждут установки ${host.updates} (ставятся автоматически)`);
  }
  if (notes.length) { lines.push('', 'НЕ СРОЧНО'); notes.forEach(n => lines.push('• ' + n)); }
  lines.push('', '—',
    'Сводка приходит каждый день в 9 утра. Не пришла — значит, не работает сайт или его почта: зайдите на сервер и запустите',
    `cd ${dir} && bash deploy/launch.sh`,
    'Отключить сводку: строка DIGEST_EMAIL=off в .env.production.');

  const subject = `Арена Работ: сводка за ${dayMonth(now)} — ` + (urgent.length ? `требует внимания (${urgent.length})` : 'всё в порядке');
  return { subject, text: lines.join('\n'), attention: urgent.length };
}

/** Кому слать: DIGEST_EMAIL, иначе почта владельца из реквизитов (OPERATOR_EMAIL). off — не слать. */
export function digestRecipient(): string | null {
  const to = (process.env.DIGEST_EMAIL || process.env.OPERATOR_EMAIL || '').trim();
  return !to || to.toLowerCase() === 'off' ? null : to;
}
