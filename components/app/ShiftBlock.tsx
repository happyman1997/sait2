'use client';

// Блоки жизненного цикла смены в карточке заказа: отклики с наймом, смена (встречающий, сдача, приёмка),
// расчёт, отзывы, жалоба, перенос даты и отказ исполнителя.
import { useState } from 'react';
import { css } from '@/lib/css';
import { uploadForm } from '@/lib/image';
import { COMPLAINT_KINDS, crewOf, dateLabel, LEAVE_REASONS, localISO, money, plural, type JobDetail } from '@/lib/jobs';
import { Corners, LABEL } from './ui';

export type Act = (path: string, body: unknown, ok: string, method?: 'POST' | 'DELETE') => Promise<boolean>;
export type ReviewOpen = (t: { target: string; name: string; rating?: number; text?: string }) => void;

const MUTED = 'color: color-mix(in srgb, var(--color-text) 66%, transparent)';
const BTN = 'height: 42px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));

/** Отклики владельцу: Нанять / Отказ / Сделать старшим / Не вышел / Чат, «Отказать остальным». */
export function ApplicantsBlock({ job, act, onChat, busy }: { job: JobDetail; act: Act; onChat: (thread: string) => void; busy: boolean }) {
  const list = job.applicantList || [];
  const crew = crewOf(job);
  const full = job.hired >= crew;
  const open = job.status === 'open' || job.status === 'staffed';
  const sent = list.filter(a => a.status === 'sent');
  return (
    <div style={css('margin-top: 18px')}>
      <div style={css(LABEL + '; margin-bottom: 10px')}>Откликнулись — {list.length}{crew > 1 ? ' · нанято ' + job.hired + (crew === Infinity ? '' : ' из ' + crew) : ''}</div>
      <div style={css('display: grid; gap: 8px')}>
        {list.map(a => (
          <div key={a.id} style={css('display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid ' + (a.status === 'hired' ? 'var(--color-accent)' : 'var(--color-divider)') + '; padding: 9px 11px')}>
            <div style={css('width: 32px; height: 32px; border: 1px solid var(--color-divider); display: grid; place-items: center; font-family: var(--font-heading); font-size: 13px; color: var(--color-accent-700); flex: none')}>{a.initials}</div>
            <div style={css('flex: 1; min-width: 140px')}>
              <div style={css('display: flex; align-items: center; gap: 6px; flex-wrap: wrap')}>
                <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: 16px; text-transform: uppercase; letter-spacing: .02em')}>{a.name}</span>
                {a.status === 'hired' && <span className="tag tag-accent" style={{ whiteSpace: 'nowrap' }}>{a.isLead ? 'старший' : 'нанят'}</span>}
              </div>
              <div style={css('font-size: 13px; ' + MUTED)}>{a.rating != null ? 'рейтинг ' + a.rating.toFixed(1) : 'пока без оценок'} · {a.done} смен{a.noShows ? ' · невыходов ' + a.noShows : ''}</div>
              <div style={css('font-size: 13px; ' + MUTED)}>{a.gear}</div>
            </div>
            <div style={css('display: flex; gap: 6px; flex-wrap: wrap; flex: none')}>
              {a.status === 'sent' && open && <>
                <button className="btn btn-secondary" disabled={busy || full} onClick={() => act('applicants/' + a.id + '/hire', {}, 'Вы наняли ' + a.name + ' — чат открыт')} title={full ? 'Смена уже набрана' : ''} style={css('height: 30px; font-size: 13px; white-space: nowrap')}>Нанять</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => act('applicants/' + a.id + '/reject', {}, 'Отказ отправлен — ' + a.name)} style={css('height: 30px; font-size: 13px')}>Отказ</button>
              </>}
              {a.status === 'hired' && <>
                <button className="btn btn-secondary" onClick={() => onChat(a.thread)} style={css('height: 30px; font-size: 13px')}>Чат</button>
                {crew > 1 && !a.isLead && open && <button className="btn btn-ghost" disabled={busy} onClick={() => act('applicants/' + a.id + '/lead', {}, a.name + ' назначен старшим')} style={css('height: 30px; font-size: 13px; white-space: nowrap')}>Сделать старшим</button>}
                {open && <button className="btn btn-ghost" disabled={busy}
                  onClick={() => { if (window.confirm('Снять ' + a.name + ' со смены? Остальные останутся, набор откроется на одно место, у исполнителя +1 к неявкам.')) act('applicants/' + a.id + '/no-show', {}, a.name + ' снят со смены — набор открыт'); }}
                  style={css('height: 30px; font-size: 13px; white-space: nowrap')}>Не вышел</button>}
              </>}
            </div>
          </div>
        ))}
      </div>
      {!list.length && <div style={css('font-size: 13.5px; line-height: 1.45; ' + MUTED)}>Откликов пока нет — заказ виден исполнителям на карте и в списке.</div>}
      {sent.length > 0 && job.hired > 0 && open && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => act('reject-rest', {}, 'Остальным отправлен отказ — ' + sent.length)} style={css('height: 34px; font-size: 13px; margin-top: 8px')}>Отказать остальным</button>
      )}
    </div>
  );
}

/** Смена: встречающий, сдача, приёмка, расчёт, отзыв, жалоба. Видна участникам. */
export function ShiftBlock({ job, isOwner, act, onChat, onReview, busy }: {
  job: JobDetail; isOwner: boolean; act: Act; onChat: (thread: string) => void; onReview: ReviewOpen; busy: boolean;
}) {
  const s = job.shift!;
  const [complaintOpen, setComplaintOpen] = useState(false);
  const kinds = COMPLAINT_KINDS[isOwner ? 'employer' : 'freelancer'];
  const [kind, setKind] = useState(kinds[0]);
  const [ctext, setCtext] = useState('');
  const [ctarget, setCtarget] = useState('');
  const accepted = job.status === 'accepted';
  const reported = job.status === 'reported';
  const brigade = s.hired.length > 1;
  const canReport = !isOwner && job.myStatus === 'hired' && !reported && !accepted && job.status !== 'cancelled' && (!brigade || s.iAmLead);

  const line = accepted
    ? (s.autoAccepted ? 'Смена закрыта автоматически: работодатель не ответил 7 дней — засчитана исполнителю.' : 'Работа принята · ' + new Date(s.acceptedAt!).toLocaleDateString('ru-RU'))
    : reported
      ? (isOwner
        ? 'Работа сдана. Примите её — осталось ' + daysLeft(s.autoAcceptAt!) + ' ' + plural(daysLeft(s.autoAcceptAt!), 'день', 'дня', 'дней') + ', потом смена закроется автоматически и будет засчитана исполнителю.'
        : 'Работа сдана — ждём приёмки. Если работодатель не ответит ещё ' + daysLeft(s.autoAcceptAt!) + ' ' + plural(daysLeft(s.autoAcceptAt!), 'день', 'дня', 'дней') + ', смена закроется и будет засчитана вам.')
      : isOwner
        ? 'Нанято ' + s.hired.length + (crewOf(job) === Infinity ? '' : ' из ' + crewOf(job)) + ' · выход ' + dateLabel(job.date) + '. Примите работу, когда исполнитель закончит.'
        : 'Вы наняты · выход ' + dateLabel(job.date) + '. Когда закончите — нажмите «Сдать работу», у работодателя будет 7 дней на приёмку.';

  const meet = job.meetPhone
    ? { who: job.meetName || 'встречающий', phone: job.meetPhone }
    : null;

  const settleLine = (() => {
    const st = s.settle;
    const way = (job.payType || 'по договорённости') + ' · ' + money(job.pay, job.unit);
    if (!st) return '';
    if (st.employer && st.freelancer) return 'Расчёт подтверждён обеими сторонами · ' + way;
    if (st.employer) return 'Работодатель отметил передачу оплаты · ждём отметку исполнителя · ' + way;
    if (st.freelancer) return 'Исполнитель отметил получение · ждём отметку работодателя · ' + way;
    return 'Договорённость: ' + way + ' · отметок пока нет';
  })();
  const settleDone = s.settle ? (isOwner ? s.settle.employer : s.settle.freelancer) : false;

  return (
    <div className="blueprint" style={css('margin-top: 18px; padding: 13px 12px')}>
      <Corners />
      <div style={css(LABEL)}>Смена</div>
      <div style={css('font-size: 14px; line-height: 1.45; margin-top: 7px')}>{line}</div>

      {!accepted && (
        <div style={css('display: flex; gap: 8px 14px; flex-wrap: wrap; align-items: baseline; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-divider)')}>
          <span style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>Встречающий</span>
          {meet
            ? <><span style={css('font-size: 14px')}>{meet.who}</span><a href={'tel:' + meet.phone.replace(/[^\d+]/g, '')} style={css('font-family: var(--font-heading); font-size: 16px; letter-spacing: .02em; white-space: nowrap')}>{meet.phone}</a></>
            : <span style={css('font-size: 14px; ' + MUTED)}>{brigade ? (s.leadName ? 'телефон у старшего — ' + s.leadName : 'старший не назначен — телефон откроется ему') : 'телефон не указан — уточните в чате'}</span>}
        </div>
      )}

      {brigade && (
        <div style={css('font-size: 13.5px; line-height: 1.45; margin-top: 8px; ' + MUTED)}>
          Бригада: {s.hired.map(h => h.name + (h.isLead ? ' (старший)' : '')).join(', ')}.
          {!isOwner && (s.iAmLead ? ' Вы старший: у вас телефон встречающего, работу за бригаду сдаёте вы.' : s.leadName ? ' Работу за бригаду сдаёт старший.' : ' Работодатель назначит старшего — он сдаёт работу за всех.')}
        </div>
      )}

      <ShiftPhotos job={job} act={act} busy={busy} />
      {job.status !== 'cancelled' && (
        <div style={css('font-size: 13px; margin-top: 8px; ' + MUTED)}>
          <a href={'/api/contract-template?job=' + job.num} download>Шаблон договора ГПХ</a> с условиями этого заказа — заполняете и подписываете сами.
        </div>
      )}

      {!isOwner && job.myStatus === 'hired' && !accepted && (
        <button className="btn btn-secondary btn-block" disabled={busy || !canReport} onClick={() => act('report', {}, 'Работа сдана — у работодателя 7 дней на приёмку')} style={css('margin-top: 10px; ' + BTN)}>
          {reported ? 'Работа сдана' : 'Сдать работу'}
        </button>
      )}
      {isOwner && !accepted && s.hired.length > 0 && job.status !== 'cancelled' && (
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act('accept', {}, 'Работа принята — оцените исполнителя')} style={css('margin-top: 12px; height: 40px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase')}>Принять работу</button>
      )}

      {(s.canChat && (isOwner ? s.hired.length === 1 : true)) && (
        <button className="btn btn-secondary btn-block" onClick={() => onChat(isOwner ? s.hired[0].thread! : s.myThread!)} style={css('margin-top: 8px; ' + BTN)}>
          {isOwner ? 'Открыть чат с исполнителем' : 'Открыть чат с работодателем'}
        </button>
      )}

      {accepted && s.settle && (
        <div style={css('margin-top: 12px; border: 1px solid var(--color-divider); padding: 11px 12px')}>
          <div style={css(LABEL)}>Расчёт</div>
          <div style={css('font-size: 14px; line-height: 1.45; margin-top: 6px')}>{settleLine}</div>
          <button className="btn btn-secondary btn-block" disabled={busy || settleDone} onClick={() => act('settle', {}, isOwner ? 'Отмечено: оплата передана' : 'Отмечено: деньги получены')} style={css('margin-top: 10px; height: 42px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>
            {isOwner ? (settleDone ? 'Оплата передана' : 'Отметить: оплата передана') : (settleDone ? 'Деньги получены' : 'Отметить: деньги получены')}
          </button>
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; ' + MUTED)}>Деньги идут напрямую между сторонами — площадка только фиксирует отметки обеих сторон.</div>
        </div>
      )}

      {accepted && s.reviewTargets.map(t => {
        const mine = s.myReviews.find(r => r.target === t.target);
        return (
          <div key={t.target} style={css('display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; border-top: 1px solid var(--color-divider); padding-top: 10px')}>
            <span style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>отзыв · {t.name}</span>
            {mine && <span style={css('font-size: 13.5px; line-height: 1.35; min-width: 0; color: var(--color-accent-900)')}>{mine.rating}/5 · {mine.text || 'без комментария'}</span>}
            <span style={{ flex: 1 }} />
            {(!mine || mine.editable) && (
              <button className="btn btn-secondary" onClick={() => onReview({ target: t.target, name: t.name, rating: mine?.rating, text: mine?.text })} style={css('height: 36px; font-size: 13px; flex: none')}>
                {mine ? 'Изменить отзыв' : isOwner ? 'Оценить исполнителя' : 'Оценить работодателя'}
              </button>
            )}
          </div>
        );
      })}

      {accepted && s.myComplaint && (
        <div style={css('margin-top: 12px; border: 1px solid var(--color-divider); padding: 10px 12px; font-size: 14px; line-height: 1.45')}>
          Жалоба «{s.myComplaint.reason}» от {new Date(s.myComplaint.at).toLocaleDateString('ru-RU')} — на рассмотрении, ответ за 3 рабочих дня.
        </div>
      )}
      {accepted && !s.myComplaint && !complaintOpen && (
        <button className="btn btn-ghost btn-block" onClick={() => { setComplaintOpen(true); setCtarget(isOwner ? (s.hired[0]?.appId || '') : ''); }} style={css('margin-top: 8px; ' + BTN)}>Пожаловаться на смену</button>
      )}
      {complaintOpen && (
        <div className="blueprint" style={css('margin-top: 12px; padding: 13px 12px')}>
          <Corners />
          <div style={css(LABEL)}>Жалоба</div>
          {isOwner && s.hired.length > 1 && (
            <div className="field" style={css('margin-top: 10px')}>
              <label htmlFor="cm-target">На кого</label>
              <select id="cm-target" className="input" value={ctarget} onChange={e => setCtarget(e.target.value)}>
                {s.hired.map(h => <option key={h.appId!} value={h.appId!}>{h.name}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={css('margin-top: 10px')}>
            <label htmlFor="cm-kind">Тема</label>
            <select id="cm-kind" className="input" value={kind} onChange={e => setKind(e.target.value)}>
              {kinds.map(k => <option key={k}>{k}</option>)}
            </select>
          </div>
          <textarea className="input" rows={3} value={ctext} onChange={e => setCtext(e.target.value)} aria-label="Жалоба" placeholder="Что произошло, с датами и суммами" style={css('width: 100%; box-sizing: border-box; margin-top: 10px')} />
          <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; color: color-mix(in srgb, var(--color-text) 70%, transparent)')}>Площадка не возвращает деньги — она разбирает поведение на площадке: ответ за 3 рабочих дня, санкции — пометка, понижение в выдаче, блокировка.</div>
          <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
            <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await act('complaint', { reason: kind, text: ctext, target: isOwner ? ctarget : undefined }, 'Жалоба принята — ответ за 3 рабочих дня')) setComplaintOpen(false); }} style={css('flex: 1; ' + BTN)}>Отправить жалобу</button>
            <button className="btn btn-ghost" onClick={() => setComplaintOpen(false)} style={css('height: 42px; font-size: 13px; padding: 0 14px')}>Назад</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Отказ исполнителя от смены после найма: причина и срок; меньше суток — пометка на 90 дней. */
export function LeaveShiftForm({ act, busy, onClose }: { act: Act; busy: boolean; onClose: () => void }) {
  const [reason, setReason] = useState(LEAVE_REASONS[0]);
  const [notice, setNotice] = useState('больше суток');
  const late = notice !== 'больше суток';
  return (
    <div className="blueprint" style={css('margin-top: 12px; padding: 13px 12px')}>
      <Corners />
      <div style={css(LABEL)}>Отказ от смены</div>
      <div className="field" style={css('margin-top: 10px')}>
        <label htmlFor="lv-reason">Причина</label>
        <select id="lv-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>{LEAVE_REASONS.map(r => <option key={r}>{r}</option>)}</select>
      </div>
      <div className="field" style={css('margin-top: 10px')}>
        <label htmlFor="lv-notice">За сколько до выхода</label>
        <select id="lv-notice" className="input" value={notice} onChange={e => setNotice(e.target.value)}><option>больше суток</option><option>меньше суток</option></select>
      </div>
      <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; color: var(--color-accent-900); border: 1px solid var(--color-accent); padding: 9px 10px')}>
        {late ? 'Поздний отказ: пометка в профиле на 90 дней и понижение в выдаче по срочным заказам. Денежных штрафов платформа не взимает.' : 'Отказ заранее: заказ вернётся в поиск, на рейтинг не влияет.'}
      </div>
      <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await act('leave', { reason, notice }, 'Вы отказались от смены')) onClose(); }} style={css('flex: 1; ' + BTN)}>Подтвердить отказ</button>
        <button className="btn btn-ghost" onClick={onClose} style={css('height: 42px; font-size: 13px; padding: 0 14px')}>Назад</button>
      </div>
    </div>
  );
}

/** Перенос даты выхода работодателем. */
export function MoveDateForm({ job, act, busy, onClose }: { job: JobDetail; act: Act; busy: boolean; onClose: () => void }) {
  const [date, setDate] = useState(job.date >= localISO() ? job.date : localISO());
  return (
    <div className="blueprint" style={css('margin-top: 12px; padding: 13px 12px')}>
      <Corners />
      <div style={css(LABEL)}>Перенос даты</div>
      <div className="field" style={css('margin-top: 10px')}>
        <label htmlFor="mv-date">Новая дата выхода</label>
        <input id="mv-date" className="input" type="date" min={localISO()} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; ' + MUTED)}>Нанятые и откликнувшиеся получат уведомление с новой датой.</div>
      <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
        <button className="btn btn-primary" disabled={busy || !date} onClick={async () => { if (await act('move', { date, today: localISO() }, 'Дата перенесена — исполнители уведомлены')) onClose(); }} style={css('flex: 1; ' + BTN)}>Перенести</button>
        <button className="btn btn-ghost" onClick={onClose} style={css('height: 42px; font-size: 13px; padding: 0 14px')}>Назад</button>
      </div>
    </div>
  );
}

/** «Фото до / после»: видят только участники смены; удалить может автор, пока работа не принята. */
function ShiftPhotos({ job, act, busy }: { job: JobDetail; act: Act; busy: boolean }) {
  const photos = job.shift?.photos || [];
  const [loading, setLoading] = useState<'before' | 'after' | null>(null);
  const locked = job.status === 'accepted' || job.status === 'cancelled';
  const upload = async (kind: 'before' | 'after', files: FileList | null) => {
    if (!files?.length) return;
    setLoading(kind);
    try {
      for (const f of Array.from(files).slice(0, 5)) {
        if (!(await act('photos', await uploadForm(f, 1600, { kind }), ''))) break;
      }
    } finally { setLoading(null); }
  };
  const col = (kind: 'before' | 'after', title: string) => {
    const list = photos.filter(p => p.kind === kind);
    return (
      <div style={{ minWidth: 0 }}>
        <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent); margin-bottom: 5px')}>{title}</div>
        <div style={css('display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px')}>
          {list.map(p => (
            <div key={p.id} style={css('position: relative; aspect-ratio: 1; border: 1px solid var(--color-divider); overflow: hidden; background: var(--color-bg)')}>
              <a href={p.url} target="_blank" rel="noreferrer" title="Открыть фото">
                <img src={p.url} alt={title} loading="lazy" style={css('width: 100%; height: 100%; object-fit: cover; display: block')} />
              </a>
              {p.mine && !locked && (
                <button onClick={() => act('photos/' + p.id, null, 'Фото убрано', 'DELETE')} disabled={busy} title="Убрать фото" aria-label="Убрать фото"
                  style={css('position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; padding: 0; border: 0; cursor: pointer; background: rgba(20, 26, 32, .7); color: #fff; font-size: 14px; line-height: 20px')}>×</button>
              )}
            </div>
          ))}
          {!locked && (
            <label title={'Приложить ' + title.toLowerCase()} style={css('position: relative; aspect-ratio: 1; min-height: 64px; display: grid; place-items: center; text-align: center; cursor: pointer; border: 1px dashed var(--color-accent); font-size: 12px; line-height: 1.2; padding: 4px; color: var(--color-accent-900); background: color-mix(in srgb, var(--color-accent) 5%, transparent)')}>
              {loading === kind ? 'загрузка…' : list.length ? '+ ещё' : '+ приложить'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple disabled={!!loading} aria-label={'Приложить ' + title.toLowerCase()}
                onChange={e => { upload(kind, e.target.files); e.target.value = ''; }} style={css('position: absolute; inset: 0; opacity: 0; cursor: pointer')} />
            </label>
          )}
          {locked && !list.length && <div style={css('font-size: 12.5px; ' + MUTED)}>нет фото</div>}
        </div>
      </div>
    );
  };
  return (
    <div style={css('display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px')}>
      {col('before', 'Фото до')}
      {col('after', 'Фото после')}
    </div>
  );
}
