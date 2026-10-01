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
import sty from './SupportPage.module.css';

type Party = { id: string; name: string; login: string; role: string };
type Complaint = {
  id: string; status: 'open' | 'confirmed' | 'rejected'; reason: string; text: string; at: string; num: number; title: string; jobStatus: string;
  author: Party; target: (Party & { marks: number; complaints: number }) | null; resolution: string | null; resolvedAt: string | null;
  assignee: { id: string; name: string } | null; deadline: string; overdue: boolean;
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
  const [tab, setTab] = useState<'complaints' | 'disputes' | 'users' | 'ads' | 'templates'>('complaints');
  return (
    <div className={sty.c41b76db}>
      <div style={css(LABEL)}>Кабинет поддержки</div>
      <h1 className={sty.c0799f7f}>Поддержка</h1>
      <div role="tablist" className={sty.c7e024ba}>
        <button role="tab" aria-selected={tab === 'complaints'} onClick={() => setTab('complaints')} style={TAB(tab === 'complaints')}>Жалобы</button>
        <button role="tab" aria-selected={tab === 'disputes'} onClick={() => setTab('disputes')} style={TAB(tab === 'disputes')}>Споры</button>
        <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')} style={TAB(tab === 'users')}>Пользователи</button>
        <button role="tab" aria-selected={tab === 'ads'} onClick={() => setTab('ads')} style={TAB(tab === 'ads')}>Реклама</button>
        <button role="tab" aria-selected={tab === 'templates'} onClick={() => setTab('templates')} style={TAB(tab === 'templates')}>Шаблоны</button>
      </div>
      {tab === 'complaints' && <Complaints />}
      {tab === 'disputes' && <Disputes />}
      {tab === 'users' && <Users />}
      {tab === 'ads' && <AdsReport />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

function Complaints() {
  const [status, setStatus] = useState<'open' | 'confirmed' | 'rejected'>('open');
  const [mine, setMine] = useState(false);
  const [list, setList] = useState<Complaint[] | null>(null);
  const load = useCallback(() => {
    setList(null);
    api<{ complaints: Complaint[] }>('/api/support/complaints?status=' + status + (mine ? '&mine=1' : '')).then(r => setList(r.complaints)).catch(() => setList([]));
  }, [status, mine]);
  useEffect(load, [load]);
  return (
    <>
      <div className={sty.c719de8d}>
        {([['open', 'Новые'], ['confirmed', 'Подтверждённые'], ['rejected', 'Отклонённые']] as const).map(([k, l]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)}>{l}</Chip>
        ))}
        <Chip active={mine} onClick={() => setMine(m => !m)}>Мои</Chip>
      </div>
      {list === null && <div style={css(MUTED)}>Загружаем…</div>}
      {list?.length === 0 && <div style={css(MUTED)}>{status === 'open' ? 'Новых жалоб нет.' : 'Пусто.'}</div>}
      <div className={sty.cef57bf5}>
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
    <div className={'blueprint ' + sty.c6dea25b}>
      <Corners />
      <div className={sty.ca7d1012}>
        <span className={'fh ' + sty.c0553864}>{c.reason}</span>
        <span style={css('font-size: 13px; ' + MUTED)}>{when(c.at)}</span>
        <span style={{ flex: 1 }} />
        <Link href={'/?job=' + c.num} className={sty.ca541880}>{'Заказ № ' + jobNum(c.num) + ' · ' + c.title}</Link>
      </div>
      {c.text && <div className={sty.ca6eccda}>{c.text}</div>}
      <div className={sty.c1f1c3b4}>
        <div><span style={css(MUTED)}>Автор: </span>{c.author.name + ' · ' + c.author.login + ' · ' + ROLE[c.author.role]}</div>
        <div>
          <span style={css(MUTED)}>На кого: </span>
          {c.target ? c.target.name + ' · ' + c.target.login + ' · ' + ROLE[c.target.role] : 'не определено'}
          {c.target && <span style={css(MUTED)}>{' · жалоб всего ' + c.target.complaints + ' · пометок ' + c.target.marks}</span>}
        </div>
      </div>
      {c.status === 'open' && <Workflow kind="complaint" id={c.id} assignee={c.assignee} deadline={c.deadline} overdue={c.overdue} onChange={onDone} />}
      {c.status === 'open' ? (
        <>
          <TemplatePicker kind="complaint" onPick={t => setNote(n => (n ? n + '\n' : '') + t)} />
          <div className={'field ' + sty.c0d69e4b}>
            <label htmlFor={'note-' + c.id}>Решение — увидит автор{c.target ? ' (и тот, на кого жаловались, если подтвердить)' : ''}</label>
            <textarea id={'note-' + c.id} className={'input ' + sty.cc3e1454} rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
              placeholder="Что проверили и почему так решили" />
          </div>
          {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
          <div className={sty.cb358ebe}>
            <button className={'btn btn-primary ' + sty.c1d41128} disabled={busy} onClick={() => decide('confirmed')}>Подтвердить — пометка на 90 дней</button>
            <button className={'btn btn-secondary ' + sty.c1d41128} disabled={busy} onClick={() => decide('rejected')}>Отклонить</button>
          </div>
        </>
      ) : (
        <div className={sty.cff7cd1c}>
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
      <form onSubmit={e => { e.preventDefault(); search(); }} className={sty.c6708c96}>
        <input className={'input ' + sty.c8b4ab7f} value={q} onChange={e => setQ(e.target.value)} aria-label="Поиск пользователя" placeholder="логин, имя, e-mail или телефон" />
        <button className={'btn btn-primary ' + sty.cc505aaf} type="submit">Найти</button>
      </form>
      {list?.length === 0 && q.trim().length >= 2 && <div style={css('margin-top: 12px; ' + MUTED)}>Никого не нашли.</div>}
      <div className={sty.ca5849bc}>
        {list?.map(u => (
          <div key={u.id} style={css('border: 1px solid ' + (u.status === 'blocked' ? 'var(--color-accent-700)' : 'var(--color-divider)') + '; padding: 12px 14px')}>
            <div className={sty.ca7d1012}>
              <span className={'fh ' + sty.cec41197}>{u.name}</span>
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
              <div className={sty.c2cb7c8c}>
                <input className={'input ' + sty.c0c5fdec} value={note[u.id] || ''} onChange={e => setNote(n => ({ ...n, [u.id]: e.target.value }))} aria-label="Причина"
                  placeholder={u.status === 'blocked' ? 'почему возвращаем доступ' : 'причина блокировки'} />
                <button className={(u.status === 'blocked' ? 'btn btn-secondary' : 'btn btn-primary') + ' ' + sty.c921d83b} onClick={() => block(u)}>
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
      <div className={sty.c65408e7}>
        <div className="field"><label htmlFor="ads-from">С</label><input id="ads-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="ads-to">По</label><input id="ads-to" className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className={'btn btn-secondary ' + sty.cf0ee752} onClick={csv} disabled={!rows?.length}>Скачать CSV для ОРД</button>
      </div>
      {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
      <table className={sty.c615feae}>
        <thead>
          <tr style={css('text-align: left; ' + MUTED)}>
            {['erid', 'Рекламодатель', 'Креатив', 'Показы', 'Клики', 'CTR'].map(h => <th key={h} className={sty.c198c058}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows?.map(r => (
            <tr key={r.erid + r.title}>
              <td className={sty.c44196b3}>{r.erid}</td>
              <td className={sty.c44196b3}>{r.advertiser}</td>
              <td className={sty.c44196b3}>{r.title}</td>
              <td className={sty.ca5a3068}>{r.impressions.toLocaleString('ru-RU')}</td>
              <td className={sty.ca5a3068}>{r.clicks.toLocaleString('ru-RU')}</td>
              <td className={sty.ca5a3068}>{r.impressions ? (100 * r.clicks / r.impressions).toFixed(1).replace('.', ',') + ' %' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <div style={css('margin-top: 10px; ' + MUTED)}>Креативов нет — добавляются командой `npm run ads -- add`.</div>}
    </>
  );
}

type Dispute = {
  id: string; num: string; status: 'open' | 'review' | 'paid' | 'withdrawn' | 'resolved'; openedBy: 'employer' | 'freelancer';
  reason: string; sum: number; text: string; response: string | null; resolution: string | null; resolvedFor: 'employer' | 'freelancer' | null;
  evidence: { ok: boolean; label: string }[]; at: string; closedAt: string | null; jobNum: number; title: string; employer: string; freelancer: string;
  assignee: { id: string; name: string } | null; deadline: string; overdue: boolean;
};
const DSTATUS: Record<Dispute['status'], string> = { open: 'ждёт ответа стороны', review: 'нужно решение', paid: 'оплачено', withdrawn: 'снят', resolved: 'решён' };

function Disputes() {
  const flash = useFlash();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [mine, setMine] = useState(false);
  const [list, setList] = useState<Dispute[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    setList(null);
    api<{ disputes: Dispute[] }>('/api/support/disputes?status=' + status + (mine ? '&mine=1' : '')).then(r => setList(r.disputes)).catch(() => setList([]));
  }, [status, mine]);
  useEffect(load, [load]);
  const decide = async (d: Dispute, side: 'employer' | 'freelancer') => {
    setErr(e => ({ ...e, [d.id]: '' }));
    try {
      await api('/api/support/disputes/' + d.id, { for: side, note: note[d.id] || '' });
      flash('Спор ' + d.num + ' решён — стороны уведомлены');
      load();
    } catch (e) { setErr(x => ({ ...x, [d.id]: e instanceof ApiError ? e.message : 'Не удалось сохранить' })); }
  };
  return (
    <>
      <div className={sty.c719de8d}>
        <Chip active={status === 'open'} onClick={() => setStatus('open')}>Незакрытые</Chip>
        <Chip active={status === 'closed'} onClick={() => setStatus('closed')}>Закрытые</Chip>
        <Chip active={mine} onClick={() => setMine(m => !m)}>Мои</Chip>
      </div>
      {list === null && <div style={css(MUTED)}>Загружаем…</div>}
      {list?.length === 0 && <div style={css(MUTED)}>{status === 'open' ? 'Незакрытых споров нет.' : 'Пусто.'}</div>}
      <div className={sty.cef57bf5}>
        {list?.map(d => (
          <div key={d.id} className={'blueprint ' + sty.c6dea25b}>
            <Corners />
            <div className={sty.ca7d1012}>
              <span className={'fh ' + sty.c4f3a4e3}>{d.num + ' · ' + d.reason}</span>
              <span className={d.status === 'review' ? 'tag tag-accent' : 'tag tag-outline'}>{DSTATUS[d.status]}</span>
              <span style={{ flex: 1 }} />
              <Link href={'/?job=' + d.jobNum} className={sty.ca541880}>{'Заказ № ' + jobNum(d.jobNum) + ' · ' + d.title}</Link>
            </div>
            <div style={css('font-size: 13.5px; margin-top: 6px; ' + MUTED)}>
              {'Работодатель: ' + d.employer + ' · Исполнитель: ' + d.freelancer + ' · открыл ' + (d.openedBy === 'employer' ? 'работодатель' : 'исполнитель') + ' ' + when(d.at) + ' · ' + d.sum.toLocaleString('ru-RU') + ' ₽'}
            </div>
            <div className={sty.ce9e3e3c}>{d.text}</div>
            {d.response && <div className={sty.c3467092}><span style={css(MUTED)}>Ответ: </span>{d.response}</div>}
            <div className={sty.c0f86b34}>
              {d.evidence.map((e, i) => <div key={i}>{(e.ok ? '✓ ' : '— ') + e.label}</div>)}
            </div>
            {d.resolution && <div className={sty.c2f8ac49}>{'Решение (' + (d.resolvedFor === 'employer' ? 'в пользу работодателя' : 'в пользу исполнителя') + '): ' + d.resolution}</div>}
            {(d.status === 'open' || d.status === 'review') && (
              <>
                <Workflow kind="dispute" id={d.id} assignee={d.assignee} deadline={d.deadline} overdue={d.overdue} onChange={load} />
                <TemplatePicker kind="dispute" onPick={t => setNote(n => ({ ...n, [d.id]: (n[d.id] ? n[d.id] + '\n' : '') + t }))} />
                <div className={'field ' + sty.c0d69e4b}>
                  <label htmlFor={'dn-' + d.id}>Решение — увидят обе стороны; проигравшей — пометка на 90 дней</label>
                  <textarea id={'dn-' + d.id} className={'input ' + sty.cb360823} rows={2} value={note[d.id] || ''} onChange={e => setNote(n => ({ ...n, [d.id]: e.target.value }))} maxLength={1000} />
                </div>
                {err[d.id] && <div role="alert" style={css(FIELD_ERR)}>{err[d.id]}</div>}
                <div className={sty.cb358ebe}>
                  <button className={'btn btn-secondary ' + sty.c1d41128} onClick={() => decide(d, 'freelancer')}>В пользу исполнителя</button>
                  <button className={'btn btn-secondary ' + sty.c1d41128} onClick={() => decide(d, 'employer')}>В пользу работодателя</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── Назначение, срок, шаблоны ─────────────────────────

type Staff = { id: string; name: string };
type Template = { id: string; kind: 'complaint' | 'dispute' | 'any'; title: string; body: string };

/** Список сотрудников и шаблонов грузится один раз на вкладку браузера. */
let staffCache: Promise<Staff[]> | null = null;
let templatesCache: Promise<Template[]> | null = null;
const loadStaff = () => (staffCache ??= api<{ staff: Staff[] }>('/api/support/staff').then(r => r.staff).catch(() => { staffCache = null; return []; }));
const loadTemplates = (fresh = false) => {
  if (fresh) templatesCache = null;
  return (templatesCache ??= api<{ templates: Template[] }>('/api/support/templates').then(r => r.templates).catch(() => { templatesCache = null; return []; }));
};

/** Подпись срока; hot — прошёл или истекает в течение суток (об этом же приходит напоминание). */
function sla(deadline: string, overdue: boolean) {
  const h = Math.round((Date.parse(deadline) - Date.now()) / 3600_000);
  if (overdue) return { text: 'срок ответа прошёл ' + new Date(deadline).toLocaleDateString('ru-RU'), hot: true };
  return h < 24
    ? { text: 'ответить в течение ' + Math.max(1, h) + ' ч', hot: true }
    : { text: 'ответить до ' + new Date(deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), hot: false };
}

function Workflow({ kind, id, assignee, deadline, overdue, onChange }: {
  kind: 'complaint' | 'dispute'; id: string; assignee: { id: string; name: string } | null; deadline: string; overdue: boolean; onChange: () => void;
}) {
  const flash = useFlash();
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => { loadStaff().then(setStaff); }, []);
  const due = sla(deadline, overdue);
  const set = async (to: string | null | undefined) => {
    try { await api('/api/support/assign/' + kind + '/' + id, to === undefined ? {} : { to }); onChange(); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Не удалось назначить'); }
  };
  return (
    <div className={sty.c10ef7a5}>
      <span className={due.hot ? 'tag tag-accent' : 'tag tag-outline'}>{due.text}</span>
      <span style={css(MUTED)}>{assignee ? 'ведёт: ' + assignee.name : 'не назначено'}</span>
      {!assignee && <button className={'btn btn-ghost ' + sty.c9056b60} onClick={() => set(undefined)}>Взять себе</button>}
      {assignee && <button className={'btn btn-ghost ' + sty.c9056b60} onClick={() => set(null)}>Снять</button>}
      {staff.length > 1 && (
        <select className={'input ' + sty.c620faee} aria-label="Передать сотруднику" value="" onChange={e => e.target.value && set(e.target.value)}>
          <option value="">передать…</option>
          {staff.filter(x => x.id !== assignee?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
    </div>
  );
}

function TemplatePicker({ kind, onPick }: { kind: 'complaint' | 'dispute'; onPick: (body: string) => void }) {
  const [list, setList] = useState<Template[]>([]);
  useEffect(() => { loadTemplates().then(t => setList(t.filter(x => x.kind === kind || x.kind === 'any'))); }, [kind]);
  if (!list.length) return null;
  return (
    <div className={sty.c2af44f9}>
      {list.map(t => (
        <button key={t.id} className={'tag tag-outline ' + sty.c4008c14} onClick={() => onPick(t.body)} title={t.body}>{'+ ' + t.title}</button>
      ))}
    </div>
  );
}

function Templates() {
  const flash = useFlash();
  const [list, setList] = useState<Template[] | null>(null);
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback((fresh = false) => { loadTemplates(fresh).then(setList); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setErr('');
    try {
      await api(edit!.id ? '/api/support/templates/' + edit!.id : '/api/support/templates', { kind: edit!.kind || 'any', title: edit!.title || '', body: edit!.body || '' }, edit!.id ? 'PATCH' : 'POST');
      flash('Шаблон сохранён'); setEdit(null); load(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Не удалось сохранить'); }
  };
  const remove = async (t: Template) => {
    if (!window.confirm('Удалить шаблон «' + t.title + '»?')) return;
    await api('/api/support/templates/' + t.id, null, 'DELETE').catch(() => {});
    load(true);
  };
  const KIND: Record<Template['kind'], string> = { complaint: 'жалобы', dispute: 'споры', any: 'для всех' };
  return (
    <>
      {!edit && <button className={'btn btn-primary ' + sty.c1d41128} onClick={() => setEdit({ kind: 'any' })}>Новый шаблон</button>}
      {edit && (
        <div className={'blueprint ' + sty.c78f5715}>
          <Corners />
          <div className={sty.c454c221}>
            {(['any', 'complaint', 'dispute'] as const).map(k => <Chip key={k} active={(edit.kind || 'any') === k} onClick={() => setEdit({ ...edit, kind: k })}>{KIND[k]}</Chip>)}
          </div>
          <div className="field"><label htmlFor="tpl-title">Название</label><input id="tpl-title" className="input" value={edit.title || ''} onChange={e => setEdit({ ...edit, title: e.target.value })} maxLength={80} /></div>
          <div className="field"><label htmlFor="tpl-body">Текст</label>
            <textarea id="tpl-body" className={'input ' + sty.c638bf70} rows={3} value={edit.body || ''} onChange={e => setEdit({ ...edit, body: e.target.value })} maxLength={1000} /></div>
          {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
          <div className={sty.cb9b7b53}>
            <button className={'btn btn-primary ' + sty.c1d41128} onClick={save}>Сохранить</button>
            <button className={'btn btn-ghost ' + sty.c1d41128} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
          </div>
        </div>
      )}
      {list?.length === 0 && !edit && <div style={css('margin-top: 12px; ' + MUTED)}>Шаблонов нет — добавьте частые ответы, чтобы не набирать их заново.</div>}
      <div className={sty.cbff87c3}>
        {list?.map(t => (
          <div key={t.id} className={sty.c6417eb2}>
            <div className={sty.c9bb37d5}>
              <span className={'fh ' + sty.c01b74d1}>{t.title}</span>
              <span className="tag tag-outline">{KIND[t.kind]}</span>
              <span style={{ flex: 1 }} />
              <button className={'btn btn-ghost ' + sty.c9056b60} onClick={() => setEdit(t)}>Изменить</button>
              <button className={'btn btn-ghost ' + sty.c9056b60} onClick={() => remove(t)}>Удалить</button>
            </div>
            <div className={sty.cf69864e}>{t.body}</div>
          </div>
        ))}
      </div>
    </>
  );
}
