'use client';

// Кабинет поддержки: жалобы (решение с комментарием), пользователи (поиск, блокировка), отчёт по рекламе.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { jobNum, localISO } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { useFlash } from '@/components/Toast';
import { Chip, Corners, FIELD_ERR, LABEL, MUTED } from './ui';

type Party = { id: string; name: string; login: string; role: string };
type Complaint = {
  id: string; status: 'open' | 'confirmed' | 'rejected'; reason: string; text: string; at: string; num: number; title: string; jobStatus: string;
  author: Party; target: (Party & { marks: number; complaints: number }) | null; resolution: string | null; resolvedAt: string | null;
};
type UserRow = {
  id: string; login: string; name: string; phone: string; email: string; role: string; status: string; isStaff: boolean; createdAt: string;
  jobs: number; done: number; noShows: number; complaints: number; marks: number; actions: { action: string; note: string; at: string }[];
};

const ROLE: Record<string, string> = { freelancer: 'исполнитель', employer: 'работодатель' };
const ACTION: Record<string, string> = { block: 'заблокирован', unblock: 'разблокирован', complaint_confirmed: 'жалоба подтверждена', complaint_rejected: 'жалоба отклонена' };
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TAB = (on: boolean) => css('cursor: pointer; padding: 8px 14px; font-family: var(--font-heading); font-size: 13px; letter-spacing: .08em; text-transform: uppercase; border: 1px solid ' +
  (on ? 'var(--color-accent)' : 'var(--color-divider)') + '; background: ' + (on ? 'var(--color-accent)' : 'transparent') + '; color: ' + (on ? '#fff' : 'inherit'));

export function SupportPage() {
  const [tab, setTab] = useState<'complaints' | 'users' | 'ads'>('complaints');
  return (
    <div style={css('flex: 1; min-height: 0; overflow: auto; padding: 22px max(clamp(16px, 2.4vw, 40px), calc((100% - 1100px) / 2)) 48px')}>
      <div style={css(LABEL)}>Кабинет поддержки</div>
      <h1 style={css('margin: 4px 0 16px; font-size: clamp(26px, 2.6vw, 34px); text-transform: uppercase; letter-spacing: .01em')}>Поддержка</h1>
      <div role="tablist" style={css('display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px')}>
        <button role="tab" aria-selected={tab === 'complaints'} onClick={() => setTab('complaints')} style={TAB(tab === 'complaints')}>Жалобы</button>
        <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')} style={TAB(tab === 'users')}>Пользователи</button>
        <button role="tab" aria-selected={tab === 'ads'} onClick={() => setTab('ads')} style={TAB(tab === 'ads')}>Реклама</button>
      </div>
      {tab === 'complaints' && <Complaints />}
      {tab === 'users' && <Users />}
      {tab === 'ads' && <AdsReport />}
    </div>
  );
}

function Complaints() {
  const [status, setStatus] = useState<'open' | 'confirmed' | 'rejected'>('open');
  const [list, setList] = useState<Complaint[] | null>(null);
  const load = useCallback(() => {
    setList(null);
    api<{ complaints: Complaint[] }>('/api/support/complaints?status=' + status).then(r => setList(r.complaints)).catch(() => setList([]));
  }, [status]);
  useEffect(load, [load]);
  return (
    <>
      <div style={css('display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px')}>
        {([['open', 'Новые'], ['confirmed', 'Подтверждённые'], ['rejected', 'Отклонённые']] as const).map(([k, l]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)}>{l}</Chip>
        ))}
      </div>
      {list === null && <div style={css(MUTED)}>Загружаем…</div>}
      {list?.length === 0 && <div style={css(MUTED)}>{status === 'open' ? 'Новых жалоб нет.' : 'Пусто.'}</div>}
      <div style={css('display: grid; gap: 12px')}>
        {list?.map(c => <ComplaintCard key={c.id} c={c} onDone={load} />)}
      </div>
    </>
  );
}

function ComplaintCard({ c, onDone }: { c: Complaint; onDone: () => void }) {
  const flash = useFlash();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'confirmed' | 'rejected') => {
    setBusy(true); setErr('');
    try {
      await api('/api/support/complaints/' + c.id, { decision, note });
      flash(decision === 'confirmed' ? 'Жалоба подтверждена — стороны уведомлены' : 'Жалоба отклонена — автор уведомлён');
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Не удалось сохранить решение'); } finally { setBusy(false); }
  };
  return (
    <div className="blueprint" style={css('padding: 14px 15px')}>
      <Corners />
      <div style={css('display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
        <span style={css('font-family: var(--font-heading); font-size: 18px; text-transform: uppercase; letter-spacing: .02em')}>{c.reason}</span>
        <span style={css('font-size: 13px; ' + MUTED)}>{when(c.at)}</span>
        <span style={{ flex: 1 }} />
        <Link href={'/?job=' + c.num} style={css('font-size: 13px')}>{'Заказ № ' + jobNum(c.num) + ' · ' + c.title}</Link>
      </div>
      {c.text && <div style={css('font-size: 14px; line-height: 1.5; margin-top: 8px; white-space: pre-wrap')}>{c.text}</div>}
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 16px; margin-top: 10px; font-size: 13.5px')}>
        <div><span style={css(MUTED)}>Автор: </span>{c.author.name + ' · ' + c.author.login + ' · ' + ROLE[c.author.role]}</div>
        <div>
          <span style={css(MUTED)}>На кого: </span>
          {c.target ? c.target.name + ' · ' + c.target.login + ' · ' + ROLE[c.target.role] : 'не определено'}
          {c.target && <span style={css(MUTED)}>{' · жалоб всего ' + c.target.complaints + ' · пометок ' + c.target.marks}</span>}
        </div>
      </div>
      {c.status === 'open' ? (
        <>
          <div className="field" style={css('margin-top: 12px')}>
            <label htmlFor={'note-' + c.id}>Решение — увидит автор{c.target ? ' (и тот, на кого жаловались, если подтвердить)' : ''}</label>
            <textarea id={'note-' + c.id} className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
              placeholder="Что проверили и почему так решили" style={css('min-height: 60px; padding: 8px 10px; resize: vertical')} />
          </div>
          {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
          <div style={css('display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap')}>
            <button className="btn btn-primary" disabled={busy} onClick={() => decide('confirmed')} style={css('height: 38px; font-size: 13px')}>Подтвердить — пометка на 90 дней</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => decide('rejected')} style={css('height: 38px; font-size: 13px')}>Отклонить</button>
          </div>
        </>
      ) : (
        <div style={css('font-size: 13.5px; margin-top: 10px; border-top: 1px solid var(--color-divider); padding-top: 8px')}>
          <span className={c.status === 'confirmed' ? 'tag tag-accent' : 'tag tag-outline'}>{c.status === 'confirmed' ? 'подтверждена' : 'отклонена'}</span>
          <span style={css(MUTED)}>{' ' + (c.resolvedAt ? when(c.resolvedAt) : '') + ' · '}</span>{c.resolution}
        </div>
      )}
    </div>
  );
}

function Users() {
  const flash = useFlash();
  const [q, setQ] = useState('');
  const [list, setList] = useState<UserRow[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const search = useCallback(async (text = q) => {
    if (text.trim().length < 2) { setList([]); return; }
    try { setList((await api<{ users: UserRow[] }>('/api/support/users?q=' + encodeURIComponent(text.trim()))).users); } catch { setList([]); }
  }, [q]);
  const block = async (u: UserRow) => {
    const blocked = u.status !== 'blocked';
    if (blocked && !window.confirm('Заблокировать ' + u.login + '? Вход закроется' + (u.role === 'employer' ? ', открытые заказы снимутся.' : ', ожидающие отклики снимутся.'))) return;
    setErr(e => ({ ...e, [u.id]: '' }));
    try {
      const r = await api<{ cancelled: number }>('/api/support/users/' + u.id + '/block', { blocked, note: note[u.id] || '' });
      flash(blocked ? 'Заблокирован' + (r.cancelled ? ' · снято заказов: ' + r.cancelled : '') : 'Доступ возвращён');
      setNote(n => ({ ...n, [u.id]: '' }));
      search();
    } catch (e) { setErr(x => ({ ...x, [u.id]: e instanceof ApiError ? e.message : 'Не получилось' })); }
  };
  return (
    <>
      <form onSubmit={e => { e.preventDefault(); search(); }} style={css('display: flex; gap: 6px; max-width: 560px')}>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} aria-label="Поиск пользователя" placeholder="логин, имя, e-mail или телефон" style={css('flex: 1; min-width: 0')} />
        <button className="btn btn-primary" type="submit" style={css('height: 42px; padding: 0 16px')}>Найти</button>
      </form>
      {list?.length === 0 && q.trim().length >= 2 && <div style={css('margin-top: 12px; ' + MUTED)}>Никого не нашли.</div>}
      <div style={css('display: grid; gap: 10px; margin-top: 14px')}>
        {list?.map(u => (
          <div key={u.id} style={css('border: 1px solid ' + (u.status === 'blocked' ? 'var(--color-accent-700)' : 'var(--color-divider)') + '; padding: 12px 14px')}>
            <div style={css('display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
              <span style={css('font-family: var(--font-heading); font-size: 17px; text-transform: uppercase')}>{u.name}</span>
              <span style={css('font-size: 13px; ' + MUTED)}>{u.login + ' · ' + ROLE[u.role] + ' · ' + formatPhone(u.phone) + ' · ' + u.email}</span>
              {u.status === 'blocked' && <span className="tag tag-accent">заблокирован</span>}
              {u.isStaff && <span className="tag tag-outline">поддержка</span>}
            </div>
            <div style={css('font-size: 13px; margin-top: 5px; ' + MUTED)}>
              {'с ' + new Date(u.createdAt).toLocaleDateString('ru-RU') + ' · ' + (u.role === 'employer' ? 'заказов ' : 'откликов ') + u.jobs + ' · закрыто ' + u.done +
                ' · невыходов ' + u.noShows + ' · жалоб на него ' + u.complaints + ' · пометок ' + u.marks}
            </div>
            {u.actions.length > 0 && (
              <div style={css('font-size: 12.5px; margin-top: 5px; ' + MUTED)}>
                {u.actions.map((a, i) => <div key={i}>{when(a.at) + ' — ' + (ACTION[a.action] || a.action) + (a.note ? ': ' + a.note : '')}</div>)}
              </div>
            )}
            {!u.isStaff && (
              <div style={css('display: flex; gap: 6px; margin-top: 9px; flex-wrap: wrap')}>
                <input className="input" value={note[u.id] || ''} onChange={e => setNote(n => ({ ...n, [u.id]: e.target.value }))} aria-label="Причина"
                  placeholder={u.status === 'blocked' ? 'почему возвращаем доступ' : 'причина блокировки'} style={css('flex: 1; min-width: 200px; height: 36px; min-height: 36px; font-size: 13px')} />
                <button className={u.status === 'blocked' ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => block(u)} style={css('height: 36px; font-size: 13px')}>
                  {u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}
                </button>
              </div>
            )}
            {err[u.id] && <div role="alert" style={css(FIELD_ERR)}>{err[u.id]}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function AdsReport() {
  const d = new Date();
  const [from, setFrom] = useState(localISO(new Date(d.getFullYear(), d.getMonth(), 1)));
  const [to, setTo] = useState(localISO(d));
  const [rows, setRows] = useState<{ erid: string; advertiser: string; title: string; impressions: number; clicks: number }[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    setErr('');
    api<{ rows: NonNullable<typeof rows> }>('/api/support/ads?from=' + from + '&to=' + to).then(r => setRows(r.rows)).catch(e => setErr(e instanceof ApiError ? e.message : 'Не удалось загрузить'));
  }, [from, to]);
  useEffect(load, [load]);
  const csv = () => {
    const lines = [['erid', 'рекламодатель', 'креатив', 'показы', 'клики'], ...(rows || []).map(r => [r.erid, r.advertiser, r.title, String(r.impressions), String(r.clicks)])]
      .map(l => l.map(x => '"' + x.replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' }));
    a.download = 'reklama-' + from + '-' + to + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div style={css('display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap')}>
        <div className="field"><label htmlFor="ads-from">С</label><input id="ads-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="ads-to">По</label><input id="ads-to" className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn btn-secondary" onClick={csv} disabled={!rows?.length} style={css('height: 42px')}>Скачать CSV для ОРД</button>
      </div>
      {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
      <table style={css('width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13.5px')}>
        <thead>
          <tr style={css('text-align: left; ' + MUTED)}>
            {['erid', 'Рекламодатель', 'Креатив', 'Показы', 'Клики', 'CTR'].map(h => <th key={h} style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider); font-weight: 600')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows?.map(r => (
            <tr key={r.erid + r.title}>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider)')}>{r.erid}</td>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider)')}>{r.advertiser}</td>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider)')}>{r.title}</td>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider); text-align: right')}>{r.impressions.toLocaleString('ru-RU')}</td>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider); text-align: right')}>{r.clicks.toLocaleString('ru-RU')}</td>
              <td style={css('padding: 6px 8px; border-bottom: 1px solid var(--color-divider); text-align: right')}>{r.impressions ? (100 * r.clicks / r.impressions).toFixed(1).replace('.', ',') + ' %' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <div style={css('margin-top: 10px; ' + MUTED)}>Креативов нет — добавляются командой `npm run ads -- add`.</div>}
    </>
  );
}
