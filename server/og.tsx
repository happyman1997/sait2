// Картинки-превью для ссылок (Open Graph): их показывают Telegram, WhatsApp и ВКонтакте, когда ссылку пересылают.
// Заказ — оплата крупно, вид работ, место и дата; у частного заказчика — гостевая карточка, без дома и имени.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import type { ReactElement, ReactNode } from 'react';
import { crewOf, dateLabel, money, type JobDetail } from '@/lib/jobs';
import { TtlCache } from './cache';
import { config } from './config';
import { AppError } from './errors';

export const OG_SIZE = { width: 1200, height: 630 };

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>['fonts']>;

// Golos Text — как на сайте. Woff (woff2 генератор не читает). Наборы — под разными именами и списком в fontFamily:
// иначе недостающие знаки (цифры, «₽» — он только в latin-ext) берутся из чужого шрифта или с Google Fonts.
// Файлы попадают в Docker-образ через outputFileTracingIncludes (next.config.ts).
const SETS = ['cyrillic', 'latin', 'latin-ext'];
const FAMILY = SETS.map(set => 'Golos-' + set).join(', ');
const FONT_DIR = join(process.cwd(), 'node_modules/@fontsource/golos-text/files');
let fonts: Promise<Fonts> | null = null;
function loadFonts(): Promise<Fonts> {
  fonts ??= Promise.all(([500, 700] as const).flatMap(weight => SETS.map(async set => ({
    name: 'Golos-' + set, weight, style: 'normal' as const,
    data: await readFile(join(FONT_DIR, 'golos-text-' + set + '-' + weight + '-normal.woff'))
  }))));
  fonts.catch(() => { fonts = null; });
  return fonts;
}

const C = { bg: '#22282e', line: 'rgba(255,255,255,0.06)', accent: '#5980a6', pay: '#b5d9fd', text: '#f2f2f3', muted: '#98989b', warn: '#e8b04a' };

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).replace(/[\s,.;:·—-]+\S*$/, '') + '…' : s);

/** Что попадает на картинку заказа — по этим же полям считается версия картинки в ссылке. */
export function jobOgData(j: JobDetail) {
  const crew = crewOf(j);
  const closed = j.status === 'cancelled' ? 'Заказ отменён' : j.status === 'reported' || j.status === 'accepted' ? 'Заказ закрыт'
    : j.status === 'staffed' || j.hired >= crew ? 'Набор закрыт' : null;
  return {
    title: clip(j.title, 80),
    type: j.typeLabel,
    pay: money(j.pay, j.unit),
    place: j.address + (j.district && !j.address.includes(j.district) ? ' · ' + j.district : ''),
    when: (j.repeat ? 'Серия с ' + dateLabel(j.date) + ' · ' + j.repeat : 'Выход ' + dateLabel(j.date)) +
      (crew === Infinity ? ' · людей — сколько угодно' : crew > 1 ? ' · нужно ' + crew + ' чел.' : ''),
    badge: closed ?? (j.urgent ? 'Срочно' : null),
    closed: !!closed
  };
}
type JobOg = ReturnType<typeof jobOgData>;

/** Короткая версия картинки: меняется вместе с условиями — мессенджер не покажет старую оплату по новой ссылке. */
export const ogVersion = (d: JobOg) => createHash('sha1').update(JSON.stringify(d)).digest('base64url').slice(0, 10);

const host = () => { try { return new URL(config.publicUrl()).host; } catch { return 'arenarabot.ru'; } };

function Pin({ size, color = C.accent }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M16 6c-3.9 0-7 3-7 6.9C9 18 16 26 16 26s7-8 7-13.1C23 9 19.9 6 16 6zm0 9.5a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" fill={color} />
    </svg>
  );
}

const corner = (pos: Record<string, number>, sides: string) => ({
  position: 'absolute' as const, width: 34, height: 34, ...pos,
  ...Object.fromEntries(sides.split(' ').map(s => ['border' + s, '3px solid ' + C.accent]))
});

/** Общая рамка: сетка «чертежа», уголки, марка сверху и адрес сайта внизу. */
function Frame({ right, footer, children }: { right?: ReactNode; footer: string; children: ReactNode }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '52px 64px 44px', position: 'relative',
      backgroundColor: C.bg, color: C.text, fontFamily: FAMILY,
      backgroundImage: `linear-gradient(${C.line} 2px, transparent 2px), linear-gradient(90deg, ${C.line} 2px, transparent 2px)`,
      backgroundSize: '60px 60px'
    }}>
      <div style={corner({ top: 24, left: 24 }, 'Top Left')} />
      <div style={corner({ top: 24, right: 24 }, 'Top Right')} />
      <div style={corner({ bottom: 24, left: 24 }, 'Bottom Left')} />
      <div style={corner({ bottom: 24, right: 24 }, 'Bottom Right')} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Pin size={46} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 5, textTransform: 'uppercase' }}>Арена Работы</div>
        </div>
        {right}
      </div>
      {children}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid ' + C.line, paddingTop: 18, fontSize: 26, color: C.muted }}>
        <div style={{ display: 'flex', color: C.text, fontWeight: 700 }}>{host()}</div>
        <div style={{ display: 'flex' }}>{footer}</div>
      </div>
    </div>
  );
}

const tag = (text: string, color: string) => (
  <div style={{ display: 'flex', border: '2px solid ' + color, color, padding: '6px 16px', fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>{text}</div>
);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 10 }}>
      <div style={{ width: 120, flexShrink: 0, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: C.muted }}>{label}</div>
      <div style={{ display: 'block', flex: 1, fontSize: 32, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

function JobCard({ d }: { d: JobOg }) {
  const titleSize = d.title.length <= 30 ? 60 : d.title.length <= 56 ? 52 : 44;
  return (
    <Frame
      right={<div style={{ display: 'flex', gap: 12 }}>{d.badge && tag(d.badge, d.closed ? C.muted : C.warn)}{tag(d.type, C.pay)}</div>}
      footer={d.closed ? 'Похожие заказы — на карте' : 'Откликнуться — на карте заказов'}
    >
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', fontSize: 112, fontWeight: 700, lineHeight: 1, color: d.closed ? C.muted : C.pay, letterSpacing: -2 }}>{d.pay}</div>
      <div style={{ display: 'block', marginTop: 14, fontSize: titleSize, fontWeight: 700, lineHeight: 1.08, textTransform: 'uppercase', lineClamp: 2 }}>{d.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', margin: '22px 0 30px' }}>
        <Row label="Где" value={d.place} />
        <Row label="Когда" value={d.when} />
      </div>
    </Frame>
  );
}

function SiteCard() {
  const pins = [{ x: 880, y: 150, pay: '3 500 ₽' }, { x: 930, y: 260, pay: '1 200 ₽/ч' }, { x: 850, y: 360, pay: '8 000 ₽' }];
  return (
    <Frame footer="Найти смену или исполнителя рядом">
      {pins.map(p => (
        <div key={p.pay} style={{ position: 'absolute', left: p.x, top: p.y, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Pin size={56} color={C.pay} />
          <div style={{ display: 'flex', backgroundColor: C.text, color: C.bg, padding: '4px 12px', fontSize: 26, fontWeight: 700 }}>{p.pay}</div>
        </div>
      ))}
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', width: 760, marginBottom: 34 }}>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1, textTransform: 'uppercase' }}>Сезонные смены</div>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1, textTransform: 'uppercase', color: C.pay }}>на карте</div>
        <div style={{ display: 'flex', width: 680, marginTop: 24, fontSize: 28, lineHeight: 1.35, color: C.muted }}>
          Уборка снега, покос, благоустройство, стройка: работодатели публикуют смены точкой на карте, исполнители откликаются рядом с домом.
        </div>
      </div>
    </Frame>
  );
}

// Готовые PNG — по содержимому: одинаковую картинку не рисуем заново (мессенджеры и боты запрашивают её часто).
const pngs = new TtlCache<ArrayBuffer>(30 * 60_000, 200);

// Рисование — заметная работа процессора: по одной картинке за раз, в очереди — не больше QUEUE_MAX.
// Перебор номеров заказов не займёт процессор целиком — лишним запросам ответ «занято».
const QUEUE_MAX = 10;
let drawing = false;
const queue: (() => void)[] = [];
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (drawing) {
    if (queue.length >= QUEUE_MAX) throw new AppError(503, 'Сервер занят — попробуйте через минуту.');
    await new Promise<void>(resolve => queue.push(resolve));
  }
  drawing = true;
  try { return await fn(); } finally { const next = queue.shift(); if (next) next(); else drawing = false; }
}

async function png(key: string, el: ReactElement): Promise<NextResponse> {
  const buf = await pngs.get(key, () => oneAtATime(async () => new ImageResponse(el, { ...OG_SIZE, fonts: await loadFonts() }).arrayBuffer()));
  return new NextResponse(buf, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }
  });
}

export const jobOgImage = (j: JobDetail) => { const d = jobOgData(j); return png('job:' + ogVersion(d), <JobCard d={d} />); };
export const siteOgImage = () => png('site:' + host(), <SiteCard />);
