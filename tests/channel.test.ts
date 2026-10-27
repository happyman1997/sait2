// Сводка заказов в Telegram-канал: текст поста, какие заказы попадают (настоящий Postgres), публикация раз в день.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://arena:arena@localhost:5432/arena_test';

const { pool, query, one } = await import('@/server/db');
const { migrate } = await import('@/server/migrate');
const jobs = await import('@/server/jobs');
const { localClock } = await import('@/server/events');
const { money } = await import('@/lib/jobs');
const { digestJobs, digestText, postDailyDigest } = await import('@/server/channel');
type DigestJob = import('@/server/channel').DigestJob;

const DAY = '2026-11-20';
const job = (o: Partial<DigestJob>): DigestJob => ({
  num: 12, typeLabel: 'Уборка снега', place: 'Москва, ул. Новая', pay: 3500, unit: 'за смену', date: '2026-11-21',
  crew: 2, hired: 0, urgent: false, repeat: null, volume: null, payType: 'наличными в день выхода', tools: 'инвентарь есть на объекте',
  orgType: 'УК / ТСЖ', rating: 4.9, applicants: 0, ...o
});
const plain = (s: string | null) => (s || '').replace(/<[^>]+>/g, '');
const O = { day: DAY, site: 'https://arenarabot.ru', area: null };

describe('сводка в канал: текст', () => {
  it('сводка вверху; ближайший день — подробно; неделя, сезон, позже — строкой; ссылки с меткой; без заказов — поста нет', () => {
    expect(digestText([], O)).toBeNull();
    const t = digestText([
      job({ num: 21, urgent: true, pay: 12000, unit: 'за заказ', crew: 3, hired: 1, volume: 'кровля 300 м²', payType: 'перевод на карту', applicants: 2 }),
      job({ num: 22, typeLabel: 'Наледь <b>', crew: 99, orgType: 'частное лицо', rating: null, tools: 'нужен свой инвентарь' }),
      job({ num: 23, date: '2026-11-25', pay: 900, unit: 'за час', payType: 'самозанятый — чек' }),
      job({ num: 24, repeat: 'по снегопаду', date: '2026-11-18', crew: 4 }),
      job({ num: 25, date: '2026-12-15', typeLabel: 'Наледь <b>' })
    ], { ...O, area: 'Москва и до 50 км вокруг' })!;
    const p = plain(t);
    expect(t).toContain('<b>Смены · Москва и до 50 км вокруг · 20 ноября</b>');
    expect(p).toContain('5 заказов · от ' + money(900, 'за час') + ' до ' + money(12000, 'за заказ') + ' за заказ');
    expect(p).toContain('Больше всего: уборка снега — 3, наледь &lt;b&gt; — 2');
    expect(p).toContain('ЗАВТРА, 21 НОЯБРЯ\n\n🔴 Срочно · Уборка снега — ' + money(12000) + ' за заказ\n' +
      'Москва, ул. Новая · нужно 2 человека · объём: кровля 300 м²\n💳 перевод на карту · 🧰 инвентарь на месте\n👤 УК / ТСЖ ★ 4,9 · 2 отклика\n→ Открыть заказ');
    expect(p).toContain('Наледь &lt;b&gt; — ' + money(3500, 'за смену') + '\nМосква, ул. Новая · людей — сколько придёт\n' +
      '💵 наличными в день выхода · 🧰 нужен свой инвентарь\n👤 Частный заказчик · откликов пока нет');
    expect(t).toContain('Наледь &lt;b&gt;');
    expect(p).toContain('НА НЕДЕЛЕ\n25 ноября · Уборка снега — ' + money(900, 'за час') + ' · Москва, ул. Новая · с чеком');
    expect(p).toContain('НА СЕЗОН\nУборка снега — ' + money(3500, 'за смену') + ' · Москва, ул. Новая · нужно 4 человека · по вызову после снегопада');
    expect(p.indexOf('НА СЕЗОН')).toBeLessThan(p.indexOf('ПОЗЖЕ'));
    expect(p).toContain('ПОЗЖЕ\n15 декабря · Наледь &lt;b&gt;');
    expect(t).toContain('<a href="https://arenarabot.ru/zakaz/21?utm_source=telegram&utm_medium=digest&utm_campaign=channel">→ Открыть заказ</a>');
    expect(t).toContain('<a href="https://arenarabot.ru/zakaz/23?utm_source=telegram&utm_medium=digest&utm_campaign=channel">Уборка снега</a>');
    expect(p.endsWith('Все 5 заказов — на карте')).toBe(true);
  });

  it('подробно — до 4 заказов дня, строк — до 10, остальное — «ещё N на карте»; один заказ — без разброса и «больше всего»', () => {
    const many = (n: number, date = '2026-11-21') => Array.from({ length: n }, (_, i) => job({ num: i + 1, date }));
    const t = plain(digestText([...many(6), ...many(12, '2026-11-24')], O));
    expect(t.match(/→ Открыть заказ/g)).toHaveLength(4);
    expect(t.match(/\n\d+ ноября · Уборка снега/g)).toHaveLength(10);
    expect(t).toContain('Ещё 4 заказа — на карте');
    const one = plain(digestText(many(1), O));
    expect(one).toContain('1 заказ\n\nЗАВТРА');
    expect(one).not.toContain('Больше всего');
    expect(one.endsWith('Заказ на карте')).toBe(true);
  });

  it('пост не длиннее предела Telegram: лишние строки уходят в «ещё N»', () => {
    const long = Array.from({ length: 30 }, (_, i) => job({ num: i + 1, date: '2026-11-24', typeLabel: 'Очень длинное название вида работ '.repeat(4), place: 'Москва, ' + 'улица '.repeat(15) }));
    const t = digestText(long, O)!;
    expect(t.length).toBeLessThanOrEqual(3900);
    expect(plain(t)).toMatch(/Ещё \d+ заказ/);
  });
});

describe('сводка в канал: заказы из базы и публикация', () => {
  const today = localClock().day;
  const at = (hourMsk: number, day = today) => new Date(day + 'T' + String(hourMsk - 3).padStart(2, '0') + ':30:00Z');
  const nums: Record<string, number> = {};

  beforeAll(async () => {
    await pool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool(), undefined, () => {});
    const emp = (await one<{ id: string }>(
      `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
       VALUES ('employer', 'emp_tg', '', '1000000001', 'emp_tg@x.ru', 'x', 'Пётр Секретов', 'Москва', 55.75, 37.61, now(), 't') RETURNING id`))!.id;
    await query(`INSERT INTO employer_profiles (user_id, org_type, org_name) VALUES ($1, 'УК / ТСЖ', 'УК «Секрет»')`, [emp]);
    const viewer = { id: emp, role: 'employer' as const, city: 'Москва', base_lat: 55.75, base_lng: 37.61 };
    const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 2);
    const later = d.toISOString().slice(0, 10);
    const mk = async (key: string, o: { lat?: number; lng?: number; address?: string; district?: string; urgent?: boolean }) => {
      const j = await jobs.createJob({
        lat: o.lat ?? 55.75, lng: o.lng ?? 37.61, address: o.address ?? 'Москва, ул. Тверская, 18', district: o.district ?? 'Москва',
        type: 'snow', typeOther: '', desc: 'Позвонить Петру +7 900 111-22-33', volume: '', crew: '2', req: '', pay: '3000', unit: 'за смену',
        payType: 'перевод на карту', dateISO: later, urgent: !!o.urgent, regular: false, repeat: '', repeatNote: '', access: ['калитка'],
        tools: 'нужен свой инвентарь', meetName: 'Пётр', meetPhone: '+7 900 111-22-33'
      }, viewer, today);
      nums[key] = j.num;
    };
    await mk('later', {});
    await mk('urgent', { urgent: true });
    await mk('todayJob', {});
    await mk('staffed', {});
    await mk('kazan', { lat: 55.79, lng: 49.12, address: 'Казань, ул. Баумана, 5', district: 'Казань' });
    await query(`UPDATE jobs SET date = $1 WHERE num = $2`, [today, nums.todayJob]);
    await query(`UPDATE jobs SET status = 'staffed' WHERE num = $1`, [nums.staffed]);
    await mk('blocked', {});
    const other = (await one<{ id: string }>(
      `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, offer_accepted_at, offer_version, status)
       VALUES ('employer', 'emp_blocked', '', '1000000002', 'b@x.ru', 'x', 'Мошенник', 'Москва', now(), 't', 'blocked') RETURNING id`))!.id;
    await query(`UPDATE jobs SET employer_id = $1 WHERE num = $2`, [other, nums.blocked]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL', 'TELEGRAM_DIGEST_CITY', 'TELEGRAM_DIGEST_HOUR']) delete process.env[k];
  });

  it('только где нужны люди; срочные первыми; сегодняшние разовые — только до обеда; город — с радиусом; без дома и имён', async () => {
    const evening = await digestJobs(today, 19);
    // Срочный — первым, дальше по дате, при равной — новые выше.
    expect(evening.jobs.map(j => j.num)).toEqual([nums.urgent, nums.kazan, nums.later]);
    expect(evening.area).toBeNull();
    expect(evening.jobs.map(j => j.num)).not.toContain(nums.blocked);
    expect((await digestJobs(today, 9)).jobs.map(j => j.num)).toContain(nums.todayJob);
    process.env.TELEGRAM_DIGEST_CITY = 'Москва';
    const msk = await digestJobs(today, 19);
    expect(msk.jobs.map(j => j.num)).not.toContain(nums.kazan);
    expect(msk.area).toBe('Москва и до 50 км вокруг');
    const text = digestText(msk.jobs, { day: today, site: 'https://arenarabot.ru', area: msk.area })!;
    expect(text).toContain('Москва, ул. Тверская');
    for (const secret of ['18', 'Пётр', 'Секрет', '900', 'Позвонить']) expect(plain(text)).not.toContain(secret);
  });

  it('публикуется раз в день в свой час; сбой — повтор; нечего публиковать — пропуск', async () => {
    const sent: { url: string; body: { chat_id: string; text: string; parse_mode: string } }[] = [];
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return fail
        ? new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
    }));
    expect(await postDailyDigest(at(19))).toBeNull(); // канал не настроен
    Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '123456789:AAHfakefakefakefakefakefakefakefake1', TELEGRAM_CHANNEL: '@arena_rabot' });
    expect(await postDailyDigest(at(18))).toBeNull();
    expect(await postDailyDigest(at(22))).toBeNull();
    expect(sent).toHaveLength(0);

    await expect(postDailyDigest(at(19))).rejects.toThrow('Telegram: 400 Bad Request: chat not found');
    fail = false;
    expect(await postDailyDigest(at(19))).toBe('sent');
    expect(await postDailyDigest(at(20))).toBeNull();
    expect(sent).toHaveLength(2);
    expect(sent[1].url).toBe('https://api.telegram.org/bot123456789:AAHfakefakefakefakefakefakefakefake1/sendMessage');
    expect(sent[1].body).toMatchObject({ chat_id: '@arena_rabot', parse_mode: 'HTML' });
    expect(sent[1].body.text).toContain('<b>Смены · ');
    expect((await one<{ message_id: string }>(`SELECT message_id FROM channel_posts WHERE kind = 'digest' AND day = $1`, [today]))!.message_id).toBe('77');

    // Другой день, свой час — 8 утра; заказов в городе нет — поста нет, день отмечен.
    process.env.TELEGRAM_DIGEST_HOUR = '8';
    process.env.TELEGRAM_DIGEST_CITY = 'Владивосток';
    const next = new Date(today + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    expect(await postDailyDigest(at(8, next.toISOString().slice(0, 10)))).toBe('empty');
    expect(await postDailyDigest(at(9, next.toISOString().slice(0, 10)))).toBeNull();
    expect(sent).toHaveLength(2);
  });
});
