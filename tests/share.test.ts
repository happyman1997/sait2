import { describe, expect, it } from 'vitest';
import { money, type JobDetail } from '@/lib/jobs';
import { shareLinks, shareText } from '@/lib/share';
import { jobOgData, jobOgImage, ogVersion, siteOgImage } from '@/server/og';

const job = (over: Partial<JobDetail> = {}) => ({
  num: 12, title: 'Покосить траву', typeLabel: 'Покос травы', address: 'Химки, ул. Ленина', district: 'Левобережный',
  pay: 5000, unit: 'за сотку', date: '2026-10-25', repeat: null, crew: 2, hired: 0, status: 'open', urgent: false, ...over
}) as JobDetail;

describe('поделиться заказом', () => {
  it('текст — что, сколько, где, когда', () => {
    expect(shareText(job())).toBe('Покосить траву — ' + money(5000, 'за сотку') + ' · Химки, ул. Ленина · 25 октября');
    expect(shareText(job({ repeat: 'ежедневно, будни' }))).toMatch(/· с 25 октября$/);
  });

  it('ссылки мессенджеров: адрес и текст закодированы', () => {
    const url = 'https://arenarabot.ru/?job=12';
    const [tg, wa, vk] = shareLinks(url, 'Покос & уборка');
    expect(tg.href).toBe('https://t.me/share/url?url=https%3A%2F%2Farenarabot.ru%2F%3Fjob%3D12&text=' + encodeURIComponent('Покос & уборка'));
    expect(decodeURIComponent(wa.href.split('?text=')[1])).toBe('Покос & уборка\n' + url);
    expect(new URL(vk.href).searchParams.get('url')).toBe(url);
    expect(new URL(vk.href).searchParams.get('title')).toBe('Покос & уборка');
  });
});

describe('картинка-превью ссылки', () => {
  it('поля: оплата, место с районом, дата, люди, метка', () => {
    const d = jobOgData(job());
    expect(d).toMatchObject({ pay: money(5000, 'за сотку'), place: 'Химки, ул. Ленина · Левобережный', when: 'Выход 25 октября · нужно 2 чел.', badge: null, closed: false });
    expect(jobOgData(job({ district: 'Химки' })).place).toBe('Химки, ул. Ленина');
    expect(jobOgData(job({ repeat: 'по снегопаду', crew: 99 })).when).toBe('Серия с 25 октября · по снегопаду · людей — сколько угодно');
    expect(jobOgData(job({ crew: 1, urgent: true })).badge).toBe('Срочно');
    expect(jobOgData(job({ hired: 2 }))).toMatchObject({ badge: 'Набор закрыт', closed: true });
    expect(jobOgData(job({ status: 'cancelled' })).badge).toBe('Заказ отменён');
    expect(jobOgData(job({ status: 'accepted' })).badge).toBe('Заказ закрыт');
    expect(jobOgData(job({ title: 'Очень '.repeat(30) })).title.length).toBeLessThanOrEqual(80);
  });

  it('версия меняется вместе с условиями', () => {
    expect(ogVersion(jobOgData(job()))).toBe(ogVersion(jobOgData(job({ applicants: 3 } as Partial<JobDetail>))));
    expect(ogVersion(jobOgData(job()))).not.toBe(ogVersion(jobOgData(job({ pay: 6000 }))));
  });

  it('рисуется PNG 1200×630 с кэшем', async () => {
    for (const res of [await jobOgImage(job()), await siteOgImage()]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const b = Buffer.from(await res.arrayBuffer());
      expect(b.subarray(1, 4).toString()).toBe('PNG');
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
    }
    const t0 = performance.now();
    await jobOgImage(job());
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('рисует по одной: очередь ограничена, лишним — «занято»', async () => {
    const all = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => jobOgImage(job({ title: 'Заказ очереди ' + i }))));
    const busy = all.filter(r => r.status === 'rejected');
    expect(all.filter(r => r.status === 'fulfilled')).toHaveLength(11);
    expect(busy.map(r => (r as PromiseRejectedResult).reason.status)).toEqual([503, 503, 503]);
    // Очередь освободилась — снова рисует.
    expect((await jobOgImage(job({ title: 'После очереди' }))).status).toBe(200);
  });
});
