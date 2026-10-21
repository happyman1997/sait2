// Сводка владельцу по запросу: проверки сервера, текст, цифры из базы (настоящий Postgres).
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const { localISO } = await import('@/lib/jobs');
const { collectStats, composeDigest, digestRecipient, parseHostFacts } = await import('@/server/digest');
type Stats = Awaited<ReturnType<typeof collectStats>>;

const calm: Stats = {
  newFl: 4, newEmp: 1, fl: 90, emp: 30, deleted: 0, newJobs: 3, openJobs: 15, apps: 12, hires: 4, done: 2, cancelled: 0, noShows: 0, reviews: 1,
  newComplaints: 0, openComplaints: 0, overdueComplaints: 0, oldestComplaint: null, newDisputes: 0, openDisputes: 0, overdueDisputes: 0, oldestDispute: null,
  mailFailed: 0, stuck: 0, staff: 1
};
const okHost = parseHostFacts([
  'dir=/opt/arena', 'disk_used=42', 'disk_avail_kb=24117248', 'backup_last=arena-20261022-0330.dump', 'backup_age_h=6',
  'backup_size=1.2M', 'backup_offsite=1', 'cert_days=61', 'health=200', 'updates=0'
].join('\n'));
const NOW = new Date('2026-10-22T06:07:00Z');

describe('сводка: проверки сервера', () => {
  it('ключ=значение, повторы ошибок, мусор пропускается', () => {
    const f = parseHostFacts('disk_used=91\nbackup_err=ОШИБКА: копия не ушла\nbackup_err=pg_dump: error\nмусор\n=1\nbackup_offsite=0\nreboot=1\ncert_days=abc\n');
    expect(f).toMatchObject({ diskUsed: 91, backupErrors: ['ОШИБКА: копия не ушла', 'pg_dump: error'], backupOffsite: false, reboot: true });
    expect(f.certDays).toBeUndefined();
    expect(okHost.diskAvailGb).toBe(23);
  });
});

describe('сводка: письмо', () => {
  it('всё в порядке — в теме и в тексте, цифры и сервер на месте', () => {
    const d = composeDigest(calm, okHost, NOW);
    expect(d.attention).toBe(0);
    expect(d.subject).toBe('Арена Работ: сводка за 22 октября — всё в порядке');
    expect(d.text).toContain('с 21 октября 09:07 по 22 октября 09:07 (время московское)');
    expect(d.text).toContain('Ничего — всё в порядке.');
    expect(d.text).toContain('Регистраций: 5 — исполнителей 4, работодателей 1');
    expect(d.text).toContain('Диск: занято 42%, свободно 23 ГБ');
    expect(d.text).toContain('Сертификат: действует ещё 61 день');
    expect(d.text).toContain('Последняя копия: arena-20261022-0330.dump (1.2M), 6 ч назад, есть в хранилище');
    expect(d.text).not.toContain('НЕ СРОЧНО');
    const fresh = composeDigest({ ...calm, openComplaints: 1, oldestComplaint: new Date(NOW.getTime() - 5 * 3600_000) }, okHost, NOW);
    expect(fresh.text).toContain('Ждут решения: жалоб 1; самому старому — меньше суток.');
  });

  it('проблемы сервера и площадки — в «Требует внимания», с командами', () => {
    const host = { ...okHost, backupAgeH: 50, backupErrors: ['ОШИБКА: копия не ушла в хранилище'], diskUsed: 93, certDays: 5, health: '502' };
    const s = { ...calm, mailFailed: 3, stuck: 2, openComplaints: 2, overdueComplaints: 1, oldestComplaint: new Date('2026-10-17T10:00:00Z'), openDisputes: 1, staff: 0 };
    const d = composeDigest(s, host, NOW);
    expect(d.attention).toBe(8);
    expect(d.subject).toBe('Арена Работ: сводка за 22 октября — требует внимания (8)');
    for (const t of ['последняя — 2 дня назад', 'Ошибка при последней резервной копии: ОШИБКА', 'занято 93%', 'истекает через 5 дней',
      'код 502', 'Не доставлено писем-уведомлений: 3', 'ждут отправки дольше 30 минут', 'жалоб 2 (просрочено 1), споров 1; самому старому — 4 дня',
      '/support', 'назначьте себя', 'bash /opt/arena/deploy/mailcheck.sh']) expect(d.text).toContain(t);
  });

  it('не срочное — отдельно; закрытый сайт не считается упавшим', () => {
    const d = composeDigest(calm, { ...okHost, backupOffsite: false, reboot: true, diskUsed: 85, certDays: 20, siteOff: true, health: undefined }, NOW);
    expect(d.attention).toBe(0);
    expect(d.text).toContain('НЕ СРОЧНО');
    for (const t of ['только на этом сервере', 'нужна перезагрузка', 'занято 85%', 'ещё 20 дней', 'Сайт закрыт для посетителей']) expect(d.text).toContain(t);
  });

  it('без проверок сервера — нет раздела «Сервер»; нет копий — срочно', () => {
    expect(composeDigest(calm, null, NOW).text).not.toContain('СЕРВЕР');
    const d = composeDigest(calm, parseHostFacts('dir=/opt/arena\nbackup_offsite=0'), NOW);
    expect(d.text).toContain('Резервных копий базы нет');
    expect(d.attention).toBe(1);
  });

  it('за неделю — в заголовке, разделе и теме', () => {
    const d = composeDigest(calm, okHost, NOW, 7);
    expect(d.subject).toBe('Арена Работ: сводка за 7 дней по 22 октября — всё в порядке');
    expect(d.text).toContain('Сводка «Арены Работ» за 7 дней: с 15 октября 09:07 по 22 октября 09:07');
    expect(d.text).toContain('\nЗА 7 ДНЕЙ\n');
  });

  it('кому по --mail: DIGEST_EMAIL, иначе OPERATOR_EMAIL', () => {
    const keep = { d: process.env.DIGEST_EMAIL, o: process.env.OPERATOR_EMAIL };
    try {
      process.env.OPERATOR_EMAIL = 'owner@x.ru'; delete process.env.DIGEST_EMAIL;
      expect(digestRecipient()).toBe('owner@x.ru');
      process.env.DIGEST_EMAIL = 'me@y.ru';
      expect(digestRecipient()).toBe('me@y.ru');
      delete process.env.DIGEST_EMAIL; delete process.env.OPERATOR_EMAIL;
      expect(digestRecipient()).toBeNull();
    } finally {
      for (const [k, v] of [['DIGEST_EMAIL', keep.d], ['OPERATOR_EMAIL', keep.o]] as const) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

describe('сводка: цифры из базы', () => {
  beforeAll(async () => {
    await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool(), undefined, () => {});
  });

  it('за сутки и на сейчас: регистрации, заказы, отклики, жалобы с просрочкой, письма', async () => {
    const mk = async (role: 'freelancer' | 'employer', login: string, ageDays = 0) => (await one<{ id: string }>(
      `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version, created_at)
       VALUES ($1, $2, '', lpad((random() * 1e9)::bigint::text, 10, '0'), $2 || '@x.ru', 'x', 'Тест Тестов', 'Москва', 55.75, 37.61, now(), 't', now() - make_interval(days => $3))
       RETURNING id`, [role, login, ageDays]))!.id;
    const emp = await mk('employer', 'emp_d');
    const fl = await mk('freelancer', 'fl_d');
    await mk('freelancer', 'fl_old', 5);
    await query(`INSERT INTO employer_profiles (user_id, org_type, org_name) VALUES ($1, 'УК / ТСЖ', 'УК')`, [emp]);
    await query(`INSERT INTO freelancer_profiles (user_id, gear) VALUES ($1, '{}')`, [fl]);
    const viewer = { id: emp, role: 'employer' as const, city: 'Москва', base_lat: 55.75, base_lng: 37.61 };
    const d = new Date(); d.setDate(d.getDate() + 3);
    const j = await jobs.createJob({
      lat: 55.75, lng: 37.61, address: 'Москва, ул. Тверская, 18', district: 'Москва', type: 'snow', typeOther: '', desc: 'Двор',
      volume: '', crew: '1', req: '', pay: '3000', unit: 'за заказ', payType: 'перевод на карту', dateISO: localISO(d),
      urgent: false, regular: false, repeat: '', repeatNote: '', access: ['калитка'], tools: 'нужен свой инвентарь', meetName: '', meetPhone: ''
    }, viewer, localISO());
    await jobs.applyToJob(j.num, {}, { id: fl, role: 'freelancer', city: 'Москва', base_lat: 55.75, base_lng: 37.61 }, localISO());
    const jobId = (await one<{ id: string }>('SELECT id FROM jobs WHERE num = $1', [j.num]))!.id;
    await query(`INSERT INTO complaints (job_id, author_id, reason, created_at) VALUES ($1, $2, 'не вышел', now() - interval '8 days'), ($1, $3, 'грубость', now())`, [jobId, emp, fl]);
    await query(`INSERT INTO notification_outbox (channel, to_addr, body, status, created_at) VALUES
      ('email', 'a@x.ru', 'x', 'failed', now()), ('email', 'b@x.ru', 'x', 'pending', now() - interval '1 hour'), ('email', 'c@x.ru', 'x', 'sent', now())`);

    const s = await collectStats();
    expect(s).toMatchObject({ newFl: 1, newEmp: 1, fl: 2, emp: 1, newJobs: 1, openJobs: 1, apps: 1, hires: 0, newComplaints: 1,
      openComplaints: 2, overdueComplaints: 1, openDisputes: 0, mailFailed: 1, stuck: 1, staff: 0 });
    expect(s.oldestComplaint).toBeInstanceOf(Date);
  });
});
