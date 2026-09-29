'use client';

// Карточка заказа в левой панели: условия, кнопка отклика с единым статусом, работодатель, отклики, отмена.
import Link from 'next/link';
import { useState } from 'react';
import { css } from '@/lib/css';
import { crewOf, dateLabel, jobNum, jobStatus, money, type JobDetail, type JobSummary } from '@/lib/jobs';
import { ApplicantsBlock, LeaveShiftForm, MoveDateForm, ShiftBlock, type Act, type ReviewOpen } from './ShiftBlock';
import { Corners, LABEL } from './ui';

const CANCEL_REASONS = ['объект отменил работы', 'погода изменилась', 'нашли своих людей', 'ошибка в заказе', 'другая причина'];

type Role = 'freelancer' | 'employer' | null;

/** Единое состояние кнопки отклика: одна цепочка приоритетов для подписи и блокировки. */
export function applyState(j: JobDetail, role: Role, reqOk: boolean) {
  if (j.status === 'cancelled') return { key: 'cancelled', label: 'Заказ отменён работодателем' };
  if (j.myStatus === 'hired') return { key: 'hired', label: j.status === 'accepted' ? 'Смена закрыта — работа принята' : 'Вы наняты — смена за вами' };
  if (j.status === 'accepted' || j.status === 'reported') return { key: 'done', label: 'Заказ закрыт' };
  if (j.myStatus === 'sent') return { key: 'applied', label: 'Отклик отправлен' };
  if (j.myStatus === 'rejected') return { key: 'rejected', label: 'Работодатель выбрал другого исполнителя' };
  if (j.hired >= crewOf(j)) return { key: 'full', label: 'Смена уже набрана' };
  if (j.requirement && role === 'freelancer' && !reqOk) return { key: 'req', label: 'Подтвердите условие работодателя' };
  return { key: 'open', label: 'Откликнуться на заказ' };
}

function brief(j: JobDetail) {
  return [
    { label: 'Контакт на объекте', value: j.meetPhone ? (j.meetName || 'встречающий') + ' · ' + j.meetPhone : (j.meetName ? j.meetName + ' — ' : '') + 'телефон откроется после найма' },
    { label: 'Как добраться', value: j.address + (j.district ? ' · ' + j.district : '') },
    { label: 'Доступ на объект', value: j.access.length ? j.access.join(', ') : 'уточняется у работодателя в чате после найма' },
    { label: 'Инвентарь', value: j.tools || 'уточняется у работодателя' },
    { label: 'Работа считается выполненной', value: (j.volume ? j.volume + ' — ' : '') + j.typeLabel.toLowerCase() + ', принято работодателем в карточке смены' },
    { label: 'Срок расчёта', value: j.payWhen || 'в день выхода, после приёмки работ' }
  ];
}

export function JobDetailPanel({ job, role, others, onClose, onApply, onWithdraw, onCancel, onEdit, onOpenJob, busy, act, onChat, onReview }: {
  job: JobDetail;
  role: Role;
  others: JobSummary[];
  onClose: () => void;
  onApply: (reqConfirmed: boolean) => void;
  onWithdraw: () => void;
  onCancel: (reason: string, notice: string) => void;
  onEdit: () => void;
  onOpenJob: (num: number) => void;
  busy: boolean;
  act: Act;
  onChat: (thread: string) => void;
  onReview: ReviewOpen;
}) {
  const [reqOk, setReqOk] = useState(false);
  const [more, setMore] = useState(false);
  const [person, setPerson] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [notice, setNotice] = useState('больше суток');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const isEmp = role === 'employer';
  const s = jobStatus(job, role);
  const st = applyState(job, role, reqOk);
  const crew = crewOf(job);
  const when = job.repeat ? 'с ' + dateLabel(job.date) : dateLabel(job.date);

  const specs = [
    { label: 'Адрес', value: job.address },
    { label: 'Дата выхода', value: when },
    { label: 'График', value: job.repeat ? job.repeat + (job.repeatNote ? ' · ' + job.repeatNote : '') : 'разовый выход' },
    ...(crew > 1 ? [{ label: 'Людей в смене', value: (crew === Infinity ? 'сколько угодно' : crew + ' чел.') + ' · набрано ' + job.hired }] : []),
    { label: 'Объём', value: job.volume || 'по договорённости' },
    { label: 'Оплата', value: money(job.pay, job.unit) },
    ...(job.requirement ? [{ label: 'Условие работодателя', value: job.requirement }] : []),
    { label: 'Способ оплаты', value: job.payType || 'по договорённости' },
    { label: 'Доступ на объект', value: job.access.length ? job.access.join(', ') : 'уточняется у работодателя' },
    { label: 'Инвентарь', value: job.tools || 'уточняется у работодателя' },
    ...(job.distanceKm != null && !isEmp ? [{ label: 'От базы', value: (job.distanceKm < 10 ? job.distanceKm.toFixed(1) : Math.round(job.distanceKm)) + ' км' }] : []),
    { label: 'Откликов', value: String(job.applicants) }
  ];

  // «Набор закрыт» — показываем похожие заказы рядом.
  const closed = !isEmp && st.key === 'full';
  const alternatives = closed ? others.filter(o => o.num !== job.num && o.hired < crewOf(o) && !o.myStatus && (o.typeId === job.typeId || o.district === job.district)).slice(0, 2) : [];

  const applyBtn = () => {
    if (!role) return (
      <Link href={'/auth?apply=' + job.num} className="btn btn-primary btn-block" style={css('margin-top: 14px; height: 52px; font-size: 16px')}>Откликнуться на заказ</Link>
    );
    return (
      <button className="btn btn-primary btn-block" onClick={() => onApply(reqOk)} disabled={busy || st.key !== 'open' || isEmp} style={css('margin-top: 14px; height: 52px; font-size: 16px')}>
        {isEmp && st.key === 'open' ? 'Откликаются исполнители' : st.label}
      </button>
    );
  };

  const lateNow = notice === 'меньше суток' && job.hired > 0;

  return (
    <div>
      <div style={css('display: flex; justify-content: space-between; align-items: baseline; gap: 10px')}>
        <div style={css(LABEL)}>Заказ {jobNum(job.num)}{job.district ? ' · ' + job.district : ''}</div>
        <button className="btn btn-ghost" onClick={onClose} style={css('height: 28px; font-size: 13px')}>Закрыть</button>
      </div>
      <h3 style={css('margin: 6px 0 0; font-size: 26px; line-height: 1.05; text-transform: uppercase; letter-spacing: .01em')}>{job.title}</h3>
      <div style={css('display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap')}>
        <span className="tag tag-accent">{job.typeLabel}</span>
        <span className={s.cls}>{s.label}</span>
        {job.mine && <span className="tag tag-neutral">ваш заказ</span>}
      </div>

      {!job.mine && (
        <div className="blueprint" style={css('margin-top: 16px; padding: 16px 17px')}>
          <Corners />
          <div style={css('font-family: var(--font-heading); font-size: 38px; line-height: 1; color: var(--color-accent-900)')}>{money(job.pay, job.unit)}</div>
          <div style={css('font-size: 14px; line-height: 1.45; margin-top: 5px; color: color-mix(in srgb, var(--color-text) 70%, transparent)')}>{when} · {job.payType || 'по договорённости'}</div>
          {job.requirement && (
            <div style={css('margin-top: 12px; border: 1px solid var(--color-accent); border-radius: 12px; padding: 9px 11px')}>
              <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>Условие заказчика</div>
              <div style={css('font-size: 13.5px; line-height: 1.45; margin-top: 4px; color: var(--color-accent-900)')}>{job.requirement}</div>
              {role === 'freelancer' && st.key !== 'applied' && st.key !== 'hired' && (
                <label style={css('display: flex; align-items: flex-start; gap: 9px; margin-top: 9px; font-size: 13px; line-height: 1.4; cursor: pointer')}>
                  <input type="checkbox" checked={reqOk} onChange={e => setReqOk(e.target.checked)} style={css('width: 17px; height: 17px; margin-top: 1px; flex: none; accent-color: var(--color-accent)')} />
                  <span>Подтверждаю: условие выполняю — можно отправлять отклик</span>
                </label>
              )}
              {!role && <div style={css('font-size: 13px; line-height: 1.4; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Подтвердить условие можно только в профиле — зарегистрируйтесь, чтобы откликнуться.</div>}
            </div>
          )}
          {applyBtn()}
          {role === 'freelancer' && job.myStatus === 'sent' && (
            <button className="btn btn-ghost btn-block" onClick={onWithdraw} disabled={busy} style={css('margin-top: 8px; height: 40px; font-size: 14px')}>Отказаться</button>
          )}
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 9px; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>
            {isEmp ? 'Откликаться может только исполнитель — для этого нужен отдельный аккаунт.' : 'Отклик ни к чему не обязывает — условия и адрес можно прочитать ниже.'}
          </div>
        </div>
      )}

      {job.cancellation && (
        <div style={css('margin-top: 14px; border: 1px solid var(--color-accent); padding: 10px 12px')}>
          <div style={css('font-size: 14px; line-height: 1.45; color: var(--color-accent-900)')}>
            Отменено {new Date(job.cancellation.at).toLocaleDateString('ru-RU')} · работодатель · {job.cancellation.reason} · {job.cancellation.notice}{job.cancellation.late ? ' · пометка в профиле' : ''}
          </div>
        </div>
      )}

      <div className="blueprint" style={css('margin-top: 20px; padding: 0')}>
        <Corners />
        {specs.map(sp => (
          <div key={sp.label} style={css('display: flex; justify-content: space-between; gap: 14px; padding: 10px 13px; border-bottom: 1px solid var(--color-divider)')}>
            <span style={css('font-family: var(--font-heading); font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{sp.label}</span>
            <span style={css('font-size: 14px; text-align: right; overflow-wrap: anywhere')}>{sp.value}</span>
          </div>
        ))}
      </div>

      <div style={css('margin-top: 16px; font-size: 14px; line-height: 1.55; color: color-mix(in srgb, var(--color-text) 75%, transparent); text-wrap: pretty; white-space: pre-line')}>{job.description}</div>

      {job.series && <SeriesBlock job={job} act={act} busy={busy} />}

      <button className="btn btn-ghost" onClick={() => setMore(m => !m)} style={css('margin-top: 12px; height: 32px; font-size: 13px; padding: 0 8px; margin-left: -8px')}>{more ? 'Скрыть условия заказа' : 'Все условия заказа →'}</button>
      {more && (
        <div className="blueprint" style={css('margin-top: 8px; padding: 0')}>
          <Corners />
          <div style={css(LABEL + '; padding: 11px 13px 0')}>До выхода</div>
          {brief(job).map(b => (
            <div key={b.label} style={css('padding: 9px 13px; border-bottom: 1px solid var(--color-divider)')}>
              <div style={css('font-family: var(--font-heading); font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{b.label}</div>
              <div style={css('font-size: 14px; line-height: 1.45; margin-top: 2px')}>{b.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="hr" style={css('margin: 18px 0')} />

      <div style={css('display: flex; align-items: center; gap: 12px')}>
        <div style={css('width: 40px; height: 40px; border: 1px solid var(--color-divider); display: grid; place-items: center; font-family: var(--font-heading); font-size: 14px; color: var(--color-accent-700); flex: none')}>{job.employer.initials}</div>
        <div style={css('min-width: 0')}>
          <button onClick={() => setPerson(true)} title="Открыть профиль" style={css('all: unset; cursor: pointer; font-family: var(--font-heading); font-weight: 600; font-size: 17px; text-transform: uppercase; letter-spacing: .02em; text-decoration: underline; text-decoration-color: var(--color-divider); text-underline-offset: 3px')}>{job.employer.name}</button>
          <div style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
            {job.employer.rating != null ? 'рейтинг ' + job.employer.rating.toFixed(1) : 'пока без оценок'} · {job.employer.jobs} заказ{job.employer.jobs % 10 === 1 && job.employer.jobs % 100 !== 11 ? '' : job.employer.jobs % 10 >= 2 && job.employer.jobs % 10 <= 4 && (job.employer.jobs % 100 < 12 || job.employer.jobs % 100 > 14) ? 'а' : 'ов'}
          </div>
        </div>
      </div>

      {role === 'freelancer' && job.myStatus === 'sent' && (
        <div style={css('margin-top: 10px; font-size: 13px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Чат откроется, когда работодатель наймёт вас на этот заказ.</div>
      )}
      {role === 'freelancer' && job.shift?.noShow && (
        <div style={css('margin-top: 12px; border: 1px solid var(--color-accent); padding: 9px 11px; font-size: 13.5px; line-height: 1.45; color: var(--color-accent-900)')}>Работодатель отметил «Не вышел» — вы сняты со смены, отметка видна в профиле.</div>
      )}
      {role === 'freelancer' && job.shift?.withdrawal && job.myStatus !== 'hired' && (
        <div style={css('margin-top: 12px; border: 1px solid var(--color-accent); padding: 9px 11px; font-size: 13.5px; line-height: 1.45; color: var(--color-accent-900)')}>
          Вы отказались {new Date(job.shift.withdrawal.at).toLocaleDateString('ru-RU')} · {job.shift.withdrawal.reason} · {job.shift.withdrawal.notice}{job.shift.withdrawal.late ? ' · пометка в профиле на 90 дней' : ' · без последствий для рейтинга'}
        </div>
      )}

      {job.shift && ((job.mine && (job.hired > 0 || job.status === 'accepted')) || (!job.mine && job.myStatus === 'hired')) && (
        <ShiftBlock job={job} isOwner={job.mine} act={act} onChat={onChat} onReview={onReview} busy={busy} />
      )}
      {role === 'freelancer' && job.myStatus === 'hired' && (job.status === 'open' || job.status === 'staffed') && !leaveOpen && (
        <button className="btn btn-ghost btn-block" onClick={() => setLeaveOpen(true)} style={css('margin-top: 8px; height: 42px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Отказаться от смены</button>
      )}
      {leaveOpen && <LeaveShiftForm act={act} busy={busy} onClose={() => setLeaveOpen(false)} />}

      {closed && (
        <div className="blueprint" style={css('margin-top: 14px; padding: 13px 14px')}>
          <Corners />
          <div style={css(LABEL)}>Набор закрыт</div>
          <div style={css('font-size: 13.5px; line-height: 1.5; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 76%, transparent); text-wrap: pretty')}>
            {(crew === 1 ? 'Единственное место на «' + job.title + '» занято' : 'Все места на «' + job.title + '» заняты') +
              ' — отклик закрыт. Если работодатель снимет исполнителя со смены, набор откроется снова.'}
          </div>
          <div style={css('display: grid; gap: 6px; margin-top: 11px')}>
            {alternatives.map(a => (
              <button key={a.num} onClick={() => onOpenJob(a.num)} style={css('text-align: left; cursor: pointer; background: transparent; border: 1px solid var(--color-divider); padding: 8px 10px; font-family: var(--font-body); color: inherit')}>
                <span style={css('display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
                  <span style={css('font-family: var(--font-heading); font-size: 15px; text-transform: uppercase; letter-spacing: .02em; min-width: 0')}>{a.title}</span>
                  <span style={css('font-family: var(--font-heading); font-size: 15px; white-space: nowrap')}>{money(a.pay, a.unit)}</span>
                </span>
                <span style={css('display: block; font-size: 13px; line-height: 1.4; margin-top: 2px; color: color-mix(in srgb, var(--color-text) 68%, transparent)')}>{(a.district || a.address) + ' · ' + dateLabel(a.date)}</span>
              </button>
            ))}
          </div>
          {!alternatives.length && <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Похожего рядом нет — загляните на карту позже.</div>}
        </div>
      )}

      {job.mine && job.applicantList && job.status !== 'cancelled' && <ApplicantsBlock job={job} act={act} onChat={onChat} busy={busy} />}

      {job.mine && job.status !== 'cancelled' && job.status !== 'accepted' && !cancelOpen && (
        <div style={css('display: grid; gap: 8px; margin-top: 14px')}>
          {job.status === 'open' && job.hired === 0 && (
            <button className="btn btn-secondary" onClick={onEdit} style={css('height: 42px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Изменить условия</button>
          )}
          <button className="btn btn-ghost" onClick={() => { setCancelOpen(true); setMoveOpen(false); }} style={css('height: 42px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Отменить смену</button>
          {!moveOpen && <button className="btn btn-ghost" onClick={() => setMoveOpen(true)} style={css('height: 42px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Перенести дату выхода</button>}
        </div>
      )}
      {moveOpen && !cancelOpen && <MoveDateForm job={job} act={act} busy={busy} onClose={() => setMoveOpen(false)} />}

      {cancelOpen && (
        <div className="blueprint" style={css('margin-top: 12px; padding: 13px 12px')}>
          <Corners />
          <div style={css(LABEL)}>Отмена смены</div>
          <div className="field" style={css('margin-top: 10px')}>
            <label htmlFor="cancel-reason">Причина</label>
            <select id="cancel-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>
              {CANCEL_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="field" style={css('margin-top: 10px')}>
            <label htmlFor="cancel-notice">За сколько до выхода</label>
            <select id="cancel-notice" className="input" value={notice} onChange={e => setNotice(e.target.value)}>
              <option>больше суток</option>
              <option>меньше суток</option>
            </select>
          </div>
          <div style={css('font-size: 13px; line-height: 1.45; margin-top: 10px; color: var(--color-accent-900); border: 1px solid var(--color-accent); padding: 9px 10px')}>
            {lateNow
              ? 'Поздняя отмена: пометка в карточке работодателя на 90 дней и уведомление нанятым исполнителям. Денежных удержаний платформа не делает — компенсацию стороны решают между собой.'
              : job.hired > 0 ? 'Отмена заранее: исполнители получат уведомление, на рейтинг не влияет.' : 'Нанятых пока нет — откликнувшиеся получат уведомление, на рейтинг не влияет.'}
          </div>
          <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
            <button className="btn btn-primary" disabled={busy} onClick={() => onCancel(reason, notice)} style={css('flex: 1; height: 42px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase')}>Подтвердить отмену</button>
            <button className="btn btn-ghost" onClick={() => setCancelOpen(false)} style={css('height: 42px; font-size: 13px; padding: 0 14px')}>Назад</button>
          </div>
        </div>
      )}

      {person && <PersonModal job={job} onClose={() => setPerson(false)} />}
    </div>
  );
}

function PersonModal({ job, onClose }: { job: JobDetail; onClose: () => void }) {
  const e = job.employer;
  const facts = [
    { label: 'Заказов размещено', value: String(e.jobs) },
    { label: 'Рейтинг', value: e.rating != null ? e.rating.toFixed(1) + ' из 5 · отзывов ' + e.reviews : 'пока без оценок' },
    { label: 'Тип', value: e.orgType },
    { label: 'Расчёт', value: job.payType || 'по договорённости' }
  ];
  return (
    <div style={css('position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; padding: 20px; background: rgba(24, 30, 36, .48)')} onKeyDown={ev => { if (ev.key === 'Escape') onClose(); }}>
      <div onClick={onClose} style={css('position: absolute; inset: 0')} />
      <div className="blueprint" role="dialog" aria-modal="true" aria-label={'Профиль работодателя ' + e.name} style={css('position: relative; z-index: 141; width: min(460px, 94vw); background: var(--color-bg); box-shadow: 0 24px 60px rgba(20, 26, 32, .3)')}>
        <Corners />
        <div style={css('max-height: 86vh; overflow-y: auto; overflow-x: hidden; padding: 20px 22px; box-sizing: border-box')}>
          <div style={css('display: flex; align-items: flex-start; gap: 14px')}>
            <div style={css('width: 58px; height: 58px; border: 1px solid var(--color-accent); display: grid; place-items: center; font-family: var(--font-heading); font-size: 20px; color: var(--color-accent-700); flex: none')}>{e.initials}</div>
            <div style={css('flex: 1; min-width: 0')}>
              <div style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>Профиль работодателя</div>
              <div style={css('font-family: var(--font-heading); font-size: 23px; line-height: 1.05; text-transform: uppercase; letter-spacing: .02em')}>{e.name}</div>
              <div style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{e.since}</div>
            </div>
            <button onClick={onClose} title="Закрыть" aria-label="Закрыть" autoFocus style={css('all: unset; cursor: pointer; flex: none; font-size: 19px; line-height: 1; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>×</button>
          </div>
          <div style={css('display: grid; gap: 7px; margin-top: 16px')}>
            {facts.map(f => (
              <div key={f.label} style={css('display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 12px; align-items: baseline; border-top: 1px solid var(--color-divider); padding-top: 7px')}>
                <span style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent); white-space: nowrap')}>{f.label}</span>
                <span style={css('font-size: 13.5px; line-height: 1.35; text-align: right')}>{f.value}</span>
              </div>
            ))}
          </div>
          {(job.access.length > 0 || job.tools) && (
            <div style={css('display: flex; flex-wrap: wrap; gap: 5px; margin-top: 14px')}>
              {job.access.concat(job.tools ? [job.tools] : []).map(t => <span key={t} className="tag tag-outline">{t}</span>)}
            </div>
          )}
          <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 14px; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>Телефон открывается после найма — в чате и карточке смены.</div>
          <button className="btn btn-secondary btn-block" onClick={onClose} style={css('margin-top: 12px; height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

/** Серия выходов (как в прототипе): каждый день — отдельная смена; нанятый может снять день, работодатель — продлить серию. */
function SeriesBlock({ job, act, busy }: { job: JobDetail; act: Act; busy: boolean }) {
  const s = job.series!;
  const [all, setAll] = useState(false);
  const days = all ? s.days : s.days.slice(0, 5);
  const iAmIn = job.myStatus === 'hired';
  return (
    <div className="blueprint" style={css('margin-top: 14px; padding: 12px 13px')}>
      <Corners />
      <div style={css('display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
        <span style={css(LABEL)}>Серия выходов</span>
        <span style={css('font-size: 13px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{s.rule}</span>
      </div>
      <div style={css('font-size: 13px; line-height: 1.45; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 72%, transparent)')}>
        {s.onCall
          ? 'Выходы по вызову после снегопада — работодатель напишет в чат, когда выходить.'
          : 'Заказ держит не один выход, а серию: каждый день — отдельная смена. Отказ от одного дня не снимает остальные.'}
      </div>
      <div style={css('display: grid; gap: 5px; margin-top: 9px')}>
        {days.map(d => {
          const status = d.skipped ? 'снят' : job.mine ? (d.skippedBy ? 'не выйдут: ' + d.skippedBy : job.hired ? 'исполнитель есть' : 'нет исполнителя') : iAmIn ? 'за вами' : 'открыт';
          return (
            <div key={d.i} style={css('display: flex; align-items: center; gap: 10px; padding: 7px 9px; border: 1px solid ' + (d.skipped ? 'color-mix(in srgb, var(--color-text) 14%, transparent)' : 'var(--color-divider)') + '; opacity: ' + (d.skipped || d.past ? '.55' : '1'))}>
              <span style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .14em; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>{String(d.i + 1).padStart(2, '0')}</span>
              <span style={css('flex: 1; min-width: 0; font-family: var(--font-heading); font-size: 14px; text-transform: uppercase; letter-spacing: .02em')}>{d.label}</span>
              <span style={css('font-size: 12.5px; color: ' + (job.mine && d.skippedBy ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 64%, transparent)'))}>{d.past ? 'прошёл' : status}</span>
              {s.canSkip && !d.past && d.date && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => act('series/skip', { day: d.date }, d.skipped ? 'Выход возвращён в серию' : 'Выход снят — остальные дни серии за вами')}
                  style={css('height: 26px; font-size: 12.5px; padding: 0 6px; flex: none')}>{d.skipped ? 'Вернуть' : 'Не смогу'}</button>
              )}
            </div>
          );
        })}
      </div>
      {s.days.length > 5 && (
        <button className="btn btn-ghost" onClick={() => setAll(a => !a)} style={css('margin-top: 6px; height: 28px; font-size: 12.5px; padding: 0 6px')}>{all ? 'Свернуть' : 'Все выходы — ' + s.days.length}</button>
      )}
      {s.canExtend && (
        <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => act('series/extend', {}, 'Серия продлена — добавлено 4 выхода')}
          style={css('margin-top: 10px; height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Продлить серию на месяц</button>
      )}
      <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 8px; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>
        {job.mine
          ? 'Продление зовёт тех же исполнителей первыми — новый набор объявляется только на пустые дни.'
          : 'Снятый день возвращается в поиск. Больше двух снятых дней подряд — пометка в профиле.'}
      </div>
    </div>
  );
}
