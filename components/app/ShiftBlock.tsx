'use client';

// Блоки жизненного цикла смены в карточке заказа: отклики с наймом, смена (встречающий, сдача, приёмка),
// расчёт, отзывы, жалоба, перенос даты и отказ исполнителя.
import { useId, useState } from 'react';
import { css } from '@/lib/css';
import { uploadForm } from '@/lib/image';
import { COMPLAINT_KINDS, crewOf, dateLabel, DISPUTE_REASONS, isSeries, LEAVE_REASONS, localISO, money, plural, type DisputeInfo, type JobDetail } from '@/lib/jobs';
import { Corners, LABEL } from './ui';
import sty from './ShiftBlock.module.css';

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
    <div className={sty.c6840f0a}>
      <div style={css(LABEL + '; margin-bottom: 10px')}>Откликнулись — {list.length}{crew > 1 ? ' · нанято ' + job.hired + (crew === Infinity ? '' : ' из ' + crew) : ''}</div>
      <div className={sty.cd726313}>
        {list.map(a => (
          <div key={a.id} style={css('display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid ' + (a.status === 'hired' ? 'var(--color-accent)' : 'var(--color-divider)') + '; padding: 9px 11px')}>
            <div className={'fh ' + sty.c9e20072}>{a.initials}</div>
            <div className={sty.c9f3d743}>
              <div className={sty.cc6d16d8}>
                <span className={'fh ' + sty.c9a3bf7a}>{a.name}</span>
                {a.status === 'hired' && <span className="tag tag-accent" style={{ whiteSpace: 'nowrap' }}>{a.isLead ? 'старший' : 'нанят'}</span>}
                {a.npd && <span className="tag tag-outline" title="Статус НПД подтверждён ФНС" style={{ whiteSpace: 'nowrap' }}>самозанятый ✓</span>}
              </div>
              <div style={css('font-size: 13px; ' + MUTED)}>{a.rating != null ? 'рейтинг ' + a.rating.toFixed(1) : 'пока без оценок'} · {a.done} смен{a.noShows ? ' · невыходов ' + a.noShows : ''}</div>
              <div style={css('font-size: 13px; ' + MUTED)}>{a.gear}</div>
            </div>
            <div className={sty.c33d0c28}>
              {a.status === 'sent' && open && <>
                <button className={'btn btn-secondary ' + sty.c93bbd0b} disabled={busy || full} onClick={() => act('applicants/' + a.id + '/hire', {}, 'Вы наняли ' + a.name + ' — чат открыт')} title={full ? 'Смена уже набрана' : ''}>Нанять</button>
                <button className={'btn btn-ghost ' + sty.c932c509} disabled={busy} onClick={() => act('applicants/' + a.id + '/reject', {}, 'Отказ отправлен — ' + a.name)}>Отказ</button>
              </>}
              {a.status === 'hired' && <>
                <button className={'btn btn-secondary ' + sty.c932c509} onClick={() => onChat(a.thread)}>Чат</button>
                {crew > 1 && !a.isLead && open && <button className={'btn btn-ghost ' + sty.c93bbd0b} disabled={busy} onClick={() => act('applicants/' + a.id + '/lead', {}, a.name + ' назначен старшим')}>Сделать старшим</button>}
                {open && <button className={'btn btn-ghost ' + sty.c93bbd0b} disabled={busy}
                  onClick={() => { if (window.confirm('Снять ' + a.name + ' со смены? Остальные останутся, набор откроется на одно место, у исполнителя +1 к неявкам.')) act('applicants/' + a.id + '/no-show', {}, a.name + ' снят со смены — набор открыт'); }}>Не вышел</button>}
              </>}
            </div>
          </div>
        ))}
      </div>
      {!list.length && <div style={css('font-size: 13.5px; line-height: 1.45; ' + MUTED)}>Откликов пока нет — заказ виден исполнителям на карте и в списке.</div>}
      {sent.length > 0 && job.hired > 0 && open && (
        <button className={'btn btn-ghost ' + sty.c742db4c} disabled={busy} onClick={() => act('reject-rest', {}, 'Остальным отправлен отказ — ' + sent.length)}>Отказать остальным</button>
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
  const accepted = job.status === 'accepted';
  const reported = job.status === 'reported';
  const brigade = s.hired.length > 1;
  // До дня выхода сдавать нечего (сервер проверяет то же самое).
  const early = !job.repeat && job.date > localISO();
  // Серия с датами сдаётся и принимается по дням (в «Серии выходов»); здесь — только «Завершить серию».
  const series = isSeries(job.repeat);
  const canReport = !isOwner && job.myStatus === 'hired' && !reported && !accepted && job.status !== 'cancelled' && (!brigade || s.iAmLead) && !early;

  const line = accepted
    ? (s.autoAccepted
      ? (series ? 'Серия закрылась автоматически через 7 дней после последнего выхода.' : 'Смена закрыта автоматически: работодатель не ответил 7 дней — засчитана исполнителю.')
      : (series ? 'Серия завершена · ' : 'Работа принята · ') + new Date(s.acceptedAt!).toLocaleDateString('ru-RU'))
    : series
      ? (isOwner
        ? 'Нанято ' + s.hired.length + (crewOf(job) === Infinity ? '' : ' из ' + crewOf(job)) + ' · серия с ' + dateLabel(job.date) + '. Каждый выход сдаётся и принимается отдельно — в «Серии выходов». «Завершить серию» закрывает заказ и открывает отзывы.'
        : 'Вы в серии с ' + dateLabel(job.date) + '. Каждый выход сдаёте отдельно — «Сдать день» в «Серии выходов»; на приёмку дня у работодателя 7 дней.')
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
    <div className={'blueprint ' + sty.c07f350a}>
      <Corners />
      <div style={css(LABEL)}>Смена</div>
      <div className={sty.c7275f29}>{line}</div>

      {!accepted && (
        <div className={sty.c46f6613}>
          <span className={'fh ' + sty.c1e8c242}>Встречающий</span>
          {meet
            ? <><span className={sty.c05854e5}>{meet.who}</span><a href={'tel:' + meet.phone.replace(/[^\d+]/g, '')} className={'fh ' + sty.ceec6d73}>{meet.phone}</a></>
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

      {!isOwner && job.myStatus === 'hired' && !accepted && !series && (
        <button className="btn btn-secondary btn-block" disabled={busy || !canReport} onClick={() => act('report', {}, 'Работа сдана — у работодателя 7 дней на приёмку')} style={css('margin-top: 10px; ' + BTN)}>
          {reported ? 'Работа сдана' : early ? 'Сдать работу — с ' + dateLabel(job.date) : 'Сдать работу'}
        </button>
      )}
      {isOwner && !accepted && s.hired.length > 0 && job.status !== 'cancelled' && (
        series
          ? <button className={'btn btn-secondary btn-block ' + sty.cb97e580} disabled={busy}
              onClick={() => { if (window.confirm('Завершить серию? Сданные дни будут приняты, оставшиеся выходы отменятся, откроются отзывы.')) act('accept', {}, 'Серия завершена — оцените исполнителей'); }}>Завершить серию</button>
          : <button className={'btn btn-primary btn-block ' + sty.cb97e580} disabled={busy} onClick={() => act('accept', {}, 'Работа принята — оцените исполнителя')}>Принять работу</button>
      )}

      {(s.canChat && (isOwner ? s.hired.length === 1 : true)) && (
        <button className="btn btn-secondary btn-block" onClick={() => onChat(isOwner ? s.hired[0].thread! : s.myThread!)} style={css('margin-top: 8px; ' + BTN)}>
          {isOwner ? 'Открыть чат с исполнителем' : 'Открыть чат с работодателем'}
        </button>
      )}

      {accepted && s.settle && (
        <div className={sty.ce2d5c19}>
          <div style={css(LABEL)}>Расчёт</div>
          <div className={sty.c8786171}>{settleLine}</div>
          {series && <div style={css('font-size: 13px; line-height: 1.4; margin-top: 4px; ' + MUTED)}>Расчёт по серии — по дням, в «Серии выходов». Отметка здесь ставится сразу за все принятые дни.</div>}
          <button className={'btn btn-secondary btn-block ' + sty.c23091ad} disabled={busy || settleDone} onClick={() => act('settle', {}, isOwner ? 'Отмечено: оплата передана' : 'Отмечено: деньги получены')}>
            {isOwner ? (settleDone ? 'Оплата передана' : 'Отметить: оплата передана') : (settleDone ? 'Деньги получены' : 'Отметить: деньги получены')}
          </button>
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; ' + MUTED)}>Деньги идут напрямую между сторонами — площадка только фиксирует отметки обеих сторон.</div>
        </div>
      )}

      <Disputes job={job} isOwner={isOwner} act={act} busy={busy} />

      {accepted && s.reviewTargets.map(t => {
        const mine = s.myReviews.find(r => r.target === t.target);
        return (
          <div key={t.target} className={sty.cefdb4bb}>
            <span className={'fh ' + sty.cbf81ab7}>отзыв · {t.name}</span>
            {mine && <span className={sty.ca5b8ed1}>{mine.rating}/5 · {mine.text || 'без комментария'}</span>}
            <span style={{ flex: 1 }} />
            {(!mine || mine.editable) && (
              <button className={'btn btn-secondary ' + sty.cd45276d} onClick={() => onReview({ target: t.target, name: t.name, rating: mine?.rating, text: mine?.text })}>
                {mine ? 'Изменить отзыв' : isOwner ? 'Оценить исполнителя' : 'Оценить работодателя'}
              </button>
            )}
          </div>
        );
      })}

      {accepted && s.myComplaint && (
        <div className={sty.ca8d24f8}>
          Жалоба «{s.myComplaint.reason}» от {new Date(s.myComplaint.at).toLocaleDateString('ru-RU')} — на рассмотрении, ответ за 3 рабочих дня.
        </div>
      )}
      {accepted && !s.myComplaint && !complaintOpen && (
        <button className="btn btn-ghost btn-block" onClick={() => setComplaintOpen(true)} style={css('margin-top: 8px; ' + BTN)}>Пожаловаться на смену</button>
      )}
      {complaintOpen && (
        <ComplaintForm role={isOwner ? 'employer' : 'freelancer'} act={act} busy={busy} onClose={() => setComplaintOpen(false)}
          targets={isOwner ? s.hired.filter(h => h.appId).map(h => ({ id: h.appId!, name: h.name })) : []} />
      )}
    </div>
  );
}

/**
 * Жалоба в поддержку: тема, текст и — у работодателя — на кого (id отклика или, для замены, id исполнителя).
 * Одна цель — без выбора. Площадка разбирает поведение, деньги не возвращает.
 */
export function ComplaintForm({ role, targets, act, busy, onClose, title = 'Жалоба' }: {
  role: 'employer' | 'freelancer'; targets: { id: string; name: string }[]; act: Act; busy: boolean; onClose: () => void; title?: string;
}) {
  const kinds = COMPLAINT_KINDS[role];
  const [kind, setKind] = useState(kinds[0]);
  const [text, setText] = useState('');
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const id = useId();
  return (
    <div className={'blueprint ' + sty.c0a5aa83}>
      <Corners />
      <div style={css(LABEL)}>{title}</div>
      {targets.length > 1 && (
        <div className={'field ' + sty.ce5a6d3c}>
          <label htmlFor={id + 't'}>На кого</label>
          <select id={id + 't'} className="input" value={target} onChange={e => setTarget(e.target.value)}>
            {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className={'field ' + sty.ce5a6d3c}>
        <label htmlFor={id + 'k'}>Тема</label>
        <select id={id + 'k'} className="input" value={kind} onChange={e => setKind(e.target.value)}>
          {kinds.map(k => <option key={k}>{k}</option>)}
        </select>
      </div>
      <textarea className={'input ' + sty.c0d7b06f} rows={3} value={text} onChange={e => setText(e.target.value)} aria-label="Жалоба" placeholder="Что произошло, с датами и суммами" />
      <div className={sty.cd225a54}>Площадка не возвращает деньги — она разбирает поведение на площадке: ответ за 3 рабочих дня, санкции — пометка, понижение в выдаче, блокировка.</div>
      <div className={sty.c5c223c4}>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await act('complaint', { reason: kind, text, target: target || undefined }, 'Жалоба принята — ответ за 3 рабочих дня')) onClose(); }} style={css('flex: 1; ' + BTN)}>Отправить жалобу</button>
        <button className={'btn btn-ghost ' + sty.c4066974} onClick={onClose}>Назад</button>
      </div>
    </div>
  );
}

/** Отказ исполнителя от смены после найма: причина и срок; меньше суток — пометка на 90 дней. */
export function LeaveShiftForm({ act, busy, onClose }: { act: Act; busy: boolean; onClose: () => void }) {
  const [reason, setReason] = useState(LEAVE_REASONS[0]);
  const [notice, setNotice] = useState('больше суток');
  const late = notice !== 'больше суток';
  return (
    <div className={'blueprint ' + sty.c0a5aa83}>
      <Corners />
      <div style={css(LABEL)}>Отказ от смены</div>
      <div className={'field ' + sty.ce5a6d3c}>
        <label htmlFor="lv-reason">Причина</label>
        <select id="lv-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>{LEAVE_REASONS.map(r => <option key={r}>{r}</option>)}</select>
      </div>
      <div className={'field ' + sty.ce5a6d3c}>
        <label htmlFor="lv-notice">За сколько до выхода</label>
        <select id="lv-notice" className="input" value={notice} onChange={e => setNotice(e.target.value)}><option>больше суток</option><option>меньше суток</option></select>
      </div>
      <div className={sty.c3e92d4d}>
        {late ? 'Поздний отказ: пометка в профиле на 90 дней и понижение в выдаче по срочным заказам. Денежных штрафов платформа не взимает.' : 'Отказ заранее: заказ вернётся в поиск, на рейтинг не влияет.'}
      </div>
      <div className={sty.c5c223c4}>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await act('leave', { reason, notice }, 'Вы отказались от смены')) onClose(); }} style={css('flex: 1; ' + BTN)}>Подтвердить отказ</button>
        <button className={'btn btn-ghost ' + sty.c4066974} onClick={onClose}>Назад</button>
      </div>
    </div>
  );
}

/** Перенос даты выхода работодателем. */
export function MoveDateForm({ job, act, busy, onClose }: { job: JobDetail; act: Act; busy: boolean; onClose: () => void }) {
  const [date, setDate] = useState(job.date >= localISO() ? job.date : localISO());
  return (
    <div className={'blueprint ' + sty.c0a5aa83}>
      <Corners />
      <div style={css(LABEL)}>Перенос даты</div>
      <div className={'field ' + sty.ce5a6d3c}>
        <label htmlFor="mv-date">Новая дата выхода</label>
        <input id="mv-date" className="input" type="date" min={localISO()} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; ' + MUTED)}>Нанятые и откликнувшиеся получат уведомление с новой датой.</div>
      <div className={sty.c5c223c4}>
        <button className="btn btn-primary" disabled={busy || !date} onClick={async () => { if (await act('move', { date, today: localISO() }, 'Дата перенесена — исполнители уведомлены')) onClose(); }} style={css('flex: 1; ' + BTN)}>Перенести</button>
        <button className={'btn btn-ghost ' + sty.c4066974} onClick={onClose}>Назад</button>
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
        <div className={'fh ' + sty.c8b8c614}>{title}</div>
        <div className={sty.c58e741b}>
          {list.map(p => (
            <div key={p.id} className={sty.c991ba27}>
              <a href={p.url} target="_blank" rel="noreferrer" title="Открыть фото">
                <img src={p.url} alt={title} loading="lazy" className={sty.c8ccc26b} />
              </a>
              {p.mine && !locked && (
                <button onClick={() => act('photos/' + p.id, null, 'Фото убрано', 'DELETE')} disabled={busy} title="Убрать фото" aria-label="Убрать фото"
                  className={sty.c20b9d26}>×</button>
              )}
            </div>
          ))}
          {!locked && (
            <label title={'Приложить ' + title.toLowerCase()} className={sty.c9a0a9d2}>
              {loading === kind ? 'загрузка…' : list.length ? '+ ещё' : '+ приложить'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple disabled={!!loading} aria-label={'Приложить ' + title.toLowerCase()}
                onChange={e => { upload(kind, e.target.files); e.target.value = ''; }} className={sty.cfa58977} />
            </label>
          )}
          {locked && !list.length && <div style={css('font-size: 12.5px; ' + MUTED)}>нет фото</div>}
        </div>
      </div>
    );
  };
  return (
    <div className={sty.cf661f70}>
      {col('before', 'Фото до')}
      {col('after', 'Фото после')}
    </div>
  );
}

const DISPUTE_STATUS: Record<DisputeInfo['status'], string> = {
  open: 'на разборе', review: 'разбор поддержки', paid: 'закрыт: оплата отправлена', withdrawn: 'закрыт: снят инициатором', resolved: 'решён поддержкой'
};

/** Споры по расчёту (как в прототипе): открыть с доказательствами, ответить, снять; спорное решает поддержка. */
function Disputes({ job, isOwner, act, busy }: { job: JobDetail; isOwner: boolean; act: Act; busy: boolean }) {
  const s = job.shift!;
  const side = isOwner ? 'employer' : 'freelancer';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(DISPUTE_REASONS[side][0]);
  const [sum, setSum] = useState(String(job.pay));
  const [text, setText] = useState('');
  const free = s.hired.filter(h => h.appId && !s.disputes.some(d => d.appId === h.appId && (d.status === 'open' || d.status === 'review')));
  const [target, setTarget] = useState(free[0]?.appId || '');
  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [explain, setExplain] = useState('');
  if (!s.disputes.length && !s.canDispute) return null;

  const submit = async () => {
    if (await act('dispute', { reason, sum, text, target: isOwner ? target || free[0]?.appId : undefined }, 'Спор передан в поддержку')) { setOpen(false); setText(''); }
  };
  return (
    <>
      {s.disputes.map(d => {
        const live = d.status === 'open' || d.status === 'review';
        const iOpened = d.mine;
        return (
          <div key={d.id} className="blueprint" style={css('margin-top: 12px; padding: 11px 12px; ' + (live ? 'border-color: var(--color-accent)' : ''))}>
            <Corners />
            <div className={sty.c9bb37d5}>
              <span className={'fh ' + sty.c717ed17}>{'Спор ' + d.num}</span>
              <span className={live ? 'tag tag-accent' : 'tag tag-outline'}>{DISPUTE_STATUS[d.status] + (d.resolvedFor ? ' · в пользу ' + (d.resolvedFor === 'employer' ? 'работодателя' : 'исполнителя') : '')}</span>
            </div>
            <div className={sty.c3467092}>
              {(d.openedBy === 'employer' ? 'Открыт работодателем ' : 'Открыт исполнителем ') + new Date(d.at).toLocaleDateString('ru-RU') + ' · ' + d.reason + ' · ' +
                d.sum.toLocaleString('ru-RU') + ' ₽' + (isOwner ? ' · ' + d.other : '') + '. ' + d.text}
            </div>
            {d.response && <div className={sty.cabe90eb}><span style={css(MUTED)}>Ответ второй стороны: </span>{d.response}</div>}
            {d.resolution && <div className={sty.cfc8e9aa}>{'Решение поддержки: ' + d.resolution}</div>}
            {live && (
              <div className={sty.c4586af7}>
                {'Поддержка отвечает в течение 3 рабочих дней. ' + (iOpened
                  ? (d.openedBy === 'freelancer' ? 'Работодатель может закрыть спор раньше — оплатив или дав пояснение.' : 'Исполнитель может дать пояснение раньше, вы — снять спор по договорённости.')
                  : 'Ответьте раньше — это ускорит разбор.') + ' Незакрытый спор виден в профиле обеих сторон.'}
              </div>
            )}
            <div className={sty.c2e6f483}>
              {d.evidence.map((e, i) => (
                <div key={i} className={sty.cd25a586}>
                  <span style={css('flex: none; width: 14px; color: ' + (e.ok ? 'var(--color-accent-700)' : 'color-mix(in srgb, var(--color-text) 50%, transparent)'))}>{e.ok ? '✓' : '—'}</span>
                  <span>{e.label}</span>
                </div>
              ))}
            </div>
            {live && d.status === 'open' && !iOpened && explainFor !== d.id && (
              <div className={sty.cadaaa9a}>
                {isOwner && d.openedBy === 'freelancer' && (
                  <button className={'btn btn-secondary ' + sty.cad84e51} disabled={busy} onClick={() => act('dispute/' + d.id, { action: 'paid' }, 'Спор закрыт — оплата отправлена')}>Оплата отправлена — закрыть спор</button>
                )}
                <button className={'btn btn-ghost ' + sty.cf8f6389} onClick={() => { setExplainFor(d.id); setExplain(''); }}>Не согласен, дать пояснение</button>
              </div>
            )}
            {explainFor === d.id && (
              <div className={sty.ce5a6d3c}>
                <textarea className={'input ' + sty.c58439e6} rows={3} value={explain} onChange={e => setExplain(e.target.value)} aria-label="Пояснение" maxLength={2000}
                  placeholder="Что произошло с вашей стороны — прочитает поддержка" />
                <div className={sty.cf2fe7f3}>
                  <button className={'btn btn-primary ' + sty.c1d41128} disabled={busy} onClick={async () => { if (await act('dispute/' + d.id, { action: 'explain', text: explain }, 'Пояснение отправлено — решение примет поддержка')) setExplainFor(null); }}>Отправить пояснение</button>
                  <button className={'btn btn-ghost ' + sty.c1d41128} onClick={() => setExplainFor(null)}>Отмена</button>
                </div>
              </div>
            )}
            {live && iOpened && (
              <button className={'btn btn-secondary btn-block ' + sty.c72a8236} disabled={busy} onClick={() => act('dispute/' + d.id, { action: 'withdraw' }, 'Спор снят')}>
                {d.openedBy === 'employer' ? 'Вопрос закрыт — снять спор' : 'Деньги пришли — снять спор'}
              </button>
            )}
          </div>
        );
      })}

      {s.canDispute && !open && (
        <button className={'btn btn-ghost btn-block ' + sty.caa11ec4} onClick={() => { setOpen(true); setTarget(free[0]?.appId || ''); }}>
          {isOwner ? 'Открыть спор по расчёту' : 'Оплата не пришла — открыть спор'}
        </button>
      )}
      {open && (
        <div className={'blueprint ' + sty.c687fe46}>
          <Corners />
          <div style={css(LABEL)}>Спор об оплате</div>
          {isOwner && free.length > 1 && (
            <div className={'field ' + sty.ce5a6d3c}>
              <label htmlFor="dsp-target">С кем спор</label>
              <select id="dsp-target" className="input" value={target} onChange={e => setTarget(e.target.value)}>
                {free.map(h => <option key={h.appId!} value={h.appId!}>{h.name}</option>)}
              </select>
            </div>
          )}
          <div className={'field ' + sty.ce5a6d3c}>
            <label htmlFor="dsp-reason">Что произошло</label>
            <select id="dsp-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>
              {DISPUTE_REASONS[side].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className={'field ' + sty.ce5a6d3c}>
            <label htmlFor="dsp-sum">Сумма, о которой спор, ₽</label>
            <input id="dsp-sum" className="input" inputMode="numeric" value={sum} onChange={e => setSum(e.target.value.replace(/[^\d ]/g, ''))} placeholder={String(job.pay)} />
          </div>
          <div className={'field ' + sty.ce5a6d3c}>
            <label htmlFor="dsp-text">Что уточнить</label>
            <textarea id="dsp-text" className={'input ' + sty.c638bf70} rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={2000}
              placeholder="Работа принята в 14:20, денег нет третий день, на звонки не отвечают" />
          </div>
          <div style={css('font-size: 13px; line-height: 1.45; margin-top: 8px; ' + MUTED)}>В спор уйдут: фото до и после, переписка по заказу, отметки о приёмке и расчёте, условия заказа ({money(job.pay, job.unit)}, {job.payType || 'способ оплаты не указан'}).</div>
          <div className={sty.cb358ebe}>
            <button className={'btn btn-primary ' + sty.c98c3d34} disabled={busy} onClick={submit}>Передать в поддержку</button>
            <button className={'btn btn-ghost ' + sty.c308e88a} onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </div>
      )}
    </>
  );
}
