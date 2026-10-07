'use client';

// Карточка заказа в левой панели: условия, кнопка отклика с единым статусом, работодатель, отклики, отмена.
import Link from 'next/link';
import { useState } from 'react';
import { css } from '@/lib/css';
import { crewOf, dateLabel, jobNum, jobStatus, localISO, money, type JobDetail, type JobSummary } from '@/lib/jobs';
import { ApplicantsBlock, LeaveShiftForm, MoveDateForm, ShiftBlock, type Act, type ReviewOpen } from './ShiftBlock';
import { SeriesBlock } from './SeriesBlock';
import { Corners, LABEL } from './ui';
import sty from './JobDetailPanel.module.css';

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
    { label: 'Контакт на объекте', value: j.meetPhone ? (j.meetName || 'встречающий') + ' · ' + j.meetPhone : (j.meetName ? j.meetName + ' — ' : '') + 'имя и телефон откроются после найма' },
    { label: 'Как добраться', value: j.address + (j.district ? ' · ' + j.district : '') + (j.addressHidden ? ' — точный адрес откроется после найма' : '') },
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
  // В день выхода разовой смены отмена всегда поздняя — сервер считает так же.
  const dayOf = !job.repeat && job.date <= localISO();
  const [notice, setNotice] = useState(dayOf ? 'меньше суток' : 'больше суток');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const isEmp = role === 'employer';
  const s = jobStatus(job, role);
  const st = applyState(job, role, reqOk);
  const crew = crewOf(job);
  const when = job.repeat ? 'с ' + dateLabel(job.date) : dateLabel(job.date);

  const specs = [
    { label: 'Адрес', value: job.addressHidden ? job.address + ' (частный заказчик: дом и точная метка — после найма)' : job.address },
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
      <Link href={'/auth?apply=' + job.num} className={'btn btn-primary btn-block ' + sty.c570d8ab}>Откликнуться на заказ</Link>
    );
    return (
      <button className={'btn btn-primary btn-block ' + sty.c570d8ab} onClick={() => onApply(reqOk)} disabled={busy || st.key !== 'open' || isEmp}>
        {isEmp && st.key === 'open' ? 'Откликаются исполнители' : st.label}
      </button>
    );
  };

  const lateNow = notice === 'меньше суток' && job.hired > 0;

  return (
    <div>
      <div className={sty.cf5c1e62}>
        <div style={css(LABEL)}>Заказ {jobNum(job.num)}{job.district ? ' · ' + job.district : ''}</div>
        <button className={'btn btn-ghost ' + sty.c4b8d758} onClick={onClose}>Закрыть</button>
      </div>
      <h3 className={sty.ce5f1500}>{job.title}</h3>
      <div className={sty.cf74fada}>
        <span className="tag tag-accent">{job.typeLabel}</span>
        <span className={s.cls}>{s.label}</span>
        {job.mine && <span className="tag tag-neutral">ваш заказ</span>}
      </div>

      {!job.mine && (
        <div className={'blueprint ' + sty.c19ead0a}>
          <Corners />
          <div className={'fh ' + sty.cedbf1c2}>{money(job.pay, job.unit)}</div>
          <div className={sty.c42a2800}>{when} · {job.payType || 'по договорённости'}</div>
          {job.requirement && (
            <div className={sty.c72c2647}>
              <div className={'fh ' + sty.c870fd56}>Условие заказчика</div>
              <div className={sty.c18fc486}>{job.requirement}</div>
              {role === 'freelancer' && st.key !== 'applied' && st.key !== 'hired' && (
                <label className={sty.c2c1389a}>
                  <input type="checkbox" checked={reqOk} onChange={e => setReqOk(e.target.checked)} className={sty.cfd133d1} />
                  <span>Подтверждаю: условие выполняю — можно отправлять отклик</span>
                </label>
              )}
              {!role && <div className={sty.ce8dd76b}>Подтвердить условие можно только в профиле — зарегистрируйтесь, чтобы откликнуться.</div>}
            </div>
          )}
          {applyBtn()}
          {role === 'freelancer' && job.myStatus === 'sent' && (
            <button className={'btn btn-ghost btn-block ' + sty.cdf03ebe} onClick={onWithdraw} disabled={busy}>Отказаться</button>
          )}
          <div className={sty.cbca74d7}>
            {isEmp ? 'Откликаться может только исполнитель — для этого нужен отдельный аккаунт.' : <>Пока вас не наняли, отклик можно отозвать. Найм — договор с работодателем на условиях заказа и <a href="/legal/offer#shift" target="_blank" rel="noreferrer">условиях смены</a>.</>}
          </div>
        </div>
      )}

      {job.cancellation && (
        <div className={sty.caabaa43}>
          <div className={sty.c765e4b4}>
            Отменено {new Date(job.cancellation.at).toLocaleDateString('ru-RU')} · работодатель · {job.cancellation.reason} · {job.cancellation.notice}{job.cancellation.late ? ' · пометка в профиле' : ''}
          </div>
        </div>
      )}

      <div className={'blueprint ' + sty.ce938c7b}>
        <Corners />
        {specs.map(sp => (
          <div key={sp.label} className={sty.c71d0385}>
            <span className={'fh ' + sty.c8d02d9e}>{sp.label}</span>
            <span className={sty.cf2ce843}>{sp.value}</span>
          </div>
        ))}
      </div>

      <div className={sty.c5dd66ad}>{job.description}</div>

      {job.series && <SeriesBlock job={job} act={act} busy={busy} onReview={onReview} />}

      <button className={'btn btn-ghost ' + sty.c6f1722e} onClick={() => setMore(m => !m)}>{more ? 'Скрыть условия заказа' : 'Все условия заказа →'}</button>
      {more && (
        <div className={'blueprint ' + sty.c1fcc62d}>
          <Corners />
          <div style={css(LABEL + '; padding: 11px 13px 0')}>До выхода</div>
          {brief(job).map(b => (
            <div key={b.label} className={sty.c8567366}>
              <div className={'fh ' + sty.c8d02d9e}>{b.label}</div>
              <div className={sty.ce8c9345}>{b.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className={'hr ' + sty.cd13d540} />

      <div className={sty.cb264e9d}>
        <div className={'fh ' + sty.c2d881fc}>{job.employer.initials}</div>
        <div className={sty.c33f2a66}>
          <button onClick={() => setPerson(true)} title="Открыть профиль" className={'fh ' + sty.c0929946}>{job.employer.name}</button>
          <div className={sty.cdde3848}>
            {job.employer.rating != null ? 'рейтинг ' + job.employer.rating.toFixed(1) : 'пока без оценок'} · {job.employer.jobs} заказ{job.employer.jobs % 10 === 1 && job.employer.jobs % 100 !== 11 ? '' : job.employer.jobs % 10 >= 2 && job.employer.jobs % 10 <= 4 && (job.employer.jobs % 100 < 12 || job.employer.jobs % 100 > 14) ? 'а' : 'ов'}
          </div>
        </div>
      </div>

      {role === 'freelancer' && job.myStatus === 'sent' && (
        <div className={sty.c8800ce9}>Чат откроется, когда работодатель наймёт вас на этот заказ.</div>
      )}
      {role === 'freelancer' && job.shift?.noShow && (
        <div className={sty.cf827e84}>Работодатель отметил «Не вышел» — вы сняты со смены, отметка видна в профиле.</div>
      )}
      {role === 'freelancer' && job.shift?.withdrawal && job.myStatus !== 'hired' && (
        <div className={sty.cf827e84}>
          Вы отказались {new Date(job.shift.withdrawal.at).toLocaleDateString('ru-RU')} · {job.shift.withdrawal.reason} · {job.shift.withdrawal.notice}{job.shift.withdrawal.late ? ' · пометка в профиле на 90 дней' : ' · без последствий для рейтинга'}
        </div>
      )}

      {job.shift && ((job.mine && (job.hired > 0 || job.status === 'accepted')) || (!job.mine && job.myStatus === 'hired')) && (
        <ShiftBlock job={job} isOwner={job.mine} act={act} onChat={onChat} onReview={onReview} busy={busy} />
      )}
      {role === 'freelancer' && job.myStatus === 'hired' && (job.status === 'open' || job.status === 'staffed') && !leaveOpen && (
        <button className={'btn btn-ghost btn-block ' + sty.c5da0771} onClick={() => setLeaveOpen(true)}>Отказаться от смены</button>
      )}
      {leaveOpen && <LeaveShiftForm job={job} act={act} busy={busy} onClose={() => setLeaveOpen(false)} />}

      {closed && (
        <div className={'blueprint ' + sty.cae70be2}>
          <Corners />
          <div style={css(LABEL)}>Набор закрыт</div>
          <div className={sty.cc3c2f87}>
            {(crew === 1 ? 'Единственное место на «' + job.title + '» занято' : 'Все места на «' + job.title + '» заняты') +
              ' — отклик закрыт. Если работодатель снимет исполнителя со смены, набор откроется снова.'}
          </div>
          <div className={sty.ca579344}>
            {alternatives.map(a => (
              <button key={a.num} onClick={() => onOpenJob(a.num)} className={sty.c5efb3fe}>
                <span className={sty.cebf0f9b}>
                  <span className={'fh ' + sty.cb541011}>{a.title}</span>
                  <span className={'fh ' + sty.ce4bef58}>{money(a.pay, a.unit)}</span>
                </span>
                <span className={sty.cd49428a}>{(a.district || a.address) + ' · ' + dateLabel(a.date)}</span>
              </button>
            ))}
          </div>
          {!alternatives.length && <div className={sty.c72e1cb3}>Похожего рядом нет — загляните на карту позже.</div>}
        </div>
      )}

      {job.mine && job.applicantList && job.status !== 'cancelled' && <ApplicantsBlock job={job} act={act} onChat={onChat} busy={busy} />}

      {job.mine && job.status !== 'cancelled' && job.status !== 'accepted' && !cancelOpen && (
        <div className={sty.c5a8e8a5}>
          {job.status === 'open' && job.hired === 0 && (
            <button className={'btn btn-secondary ' + sty.c98c3d34} onClick={onEdit}>Изменить условия</button>
          )}
          <button className={'btn btn-ghost ' + sty.c98c3d34} onClick={() => { setCancelOpen(true); setMoveOpen(false); }}>Отменить смену</button>
          {!moveOpen && <button className={'btn btn-ghost ' + sty.c98c3d34} onClick={() => setMoveOpen(true)}>Перенести дату выхода</button>}
        </div>
      )}
      {moveOpen && !cancelOpen && <MoveDateForm job={job} act={act} busy={busy} onClose={() => setMoveOpen(false)} />}

      {cancelOpen && (
        <div className={'blueprint ' + sty.c0a5aa83}>
          <Corners />
          <div style={css(LABEL)}>Отмена смены</div>
          <div className={'field ' + sty.ce5a6d3c}>
            <label htmlFor="cancel-reason">Причина</label>
            <select id="cancel-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>
              {CANCEL_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className={'field ' + sty.ce5a6d3c}>
            <label htmlFor="cancel-notice">За сколько до выхода</label>
            <select id="cancel-notice" className="input" value={notice} disabled={dayOf} onChange={e => setNotice(e.target.value)}>
              <option>больше суток</option>
              <option>меньше суток</option>
            </select>
          </div>
          <div className={sty.c3e92d4d}>
            {lateNow
              ? 'Поздняя отмена: пометка в карточке работодателя на 90 дней и уведомление нанятым исполнителям. Денежных удержаний платформа не делает — компенсацию стороны решают между собой.'
              : job.hired > 0 ? 'Отмена заранее: исполнители получат уведомление, на рейтинг не влияет.' : 'Нанятых пока нет — откликнувшиеся получат уведомление, на рейтинг не влияет.'}
          </div>
          <div className={sty.c5c223c4}>
            <button className={'btn btn-primary ' + sty.ca96b295} disabled={busy} onClick={() => onCancel(reason, notice)}>Подтвердить отмену</button>
            <button className={'btn btn-ghost ' + sty.c4066974} onClick={() => setCancelOpen(false)}>Назад</button>
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
    <div className={sty.cbc34164} onKeyDown={ev => { if (ev.key === 'Escape') onClose(); }}>
      <div onClick={onClose} className={sty.ccd59aab} />
      <div className={'blueprint ' + sty.cb9527de} role="dialog" aria-modal="true" aria-label={'Профиль работодателя ' + e.name}>
        <Corners />
        <div className={sty.c83a5d4f}>
          <div className={sty.c16ff81f}>
            <div className={'fh ' + sty.cb63922d}>{e.initials}</div>
            <div className={sty.c8b4ab7f}>
              <div className={'fh ' + sty.c4afa4c3}>Профиль работодателя</div>
              <div className={'fh ' + sty.c439f72f}>{e.name}</div>
              <div className={sty.cdde3848}>{e.since}</div>
            </div>
            <button onClick={onClose} title="Закрыть" aria-label="Закрыть" autoFocus className={sty.c3e4983f}>×</button>
          </div>
          <div className={sty.ccc38f46}>
            {facts.map(f => (
              <div key={f.label} className={sty.c0271a98}>
                <span className={'fh ' + sty.c7c21188}>{f.label}</span>
                <span className={sty.ca2be77f}>{f.value}</span>
              </div>
            ))}
          </div>
          {(job.access.length > 0 || job.tools) && (
            <div className={sty.c13d4ae9}>
              {job.access.concat(job.tools ? [job.tools] : []).map(t => <span key={t} className="tag tag-outline">{t}</span>)}
            </div>
          )}
          <div className={sty.cc43d001}>Телефон открывается после найма — в чате и карточке смены.</div>
          <button className={'btn btn-secondary btn-block ' + sty.c72a8236} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
