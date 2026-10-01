'use client';

// «Все заказы списком» — выезжающая слева панель с поиском.
import { Fragment } from 'react';
import { dateLabel, jobNum, jobStatus, money, type JobSummary } from '@/lib/jobs';
import { AdSlot } from './AdSlot';
import sty from './JobListOverlay.module.css';

export function JobListOverlay({ jobs, q, setQ, onClose, onOpen, onHover, role }: {
  jobs: JobSummary[]; q: string; setQ: (q: string) => void; onClose: () => void; onOpen: (num: number) => void;
  onHover: (num: number | null) => void; role: 'freelancer' | 'employer' | null;
}) {
  return (
    <div style={{ display: 'contents' }}>
      <div onClick={onClose} className={sty.c9a3a89e} />
      <div role="dialog" aria-label="Заказы на карте" className={sty.cc2d836c}>
        <div className={sty.cf5c1e62}>
          <div className={sty.c7cf5cb6}>
            <div className={'fh ' + sty.c90624d9}>Заказы на карте</div>
            <div className={'fh ' + sty.c278f073}>{jobs.length}</div>
          </div>
          <button className={'btn btn-ghost ' + sty.c5074ec5} onClick={onClose}>Закрыть</button>
        </div>
        <div className={sty.cb76e636}>
          <input className={'input ' + sty.c168acf6} type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Поиск" placeholder="Поиск: тип работы, адрес, город" />
          {q.trim() && <button className={'btn btn-ghost ' + sty.c07b4ee6} onClick={() => setQ('')}>Сброс</button>}
        </div>
        <div className={sty.cf7fdbae}>
          {jobs.map((j, i) => {
            const s = jobStatus(j, role);
            return (
              <Fragment key={j.num}>
              {i === 3 && <AdSlot place="feed" />}
              <button onClick={() => onOpen(j.num)} onMouseEnter={() => onHover(j.num)} onMouseLeave={() => onHover(null)} className={'job-row ' + sty.c38739c6}>
                <span className={sty.c99ccaca}>
                  <span className={'fh ' + sty.c12af3c0}>{jobNum(j.num)}</span>
                  <span className={'fh ' + sty.c36d7f6a}>{money(j.pay, j.unit)}</span>
                </span>
                <span className={'fh ' + sty.c0177dc8}>{j.title}</span>
                <span className={sty.c5774fa4}>
                  {j.address} · {j.repeat ? 'с ' + dateLabel(j.date) : dateLabel(j.date)}{j.distanceKm != null ? ' · ' + (j.distanceKm < 10 ? j.distanceKm.toFixed(1) : Math.round(j.distanceKm)) + ' км' : ''}
                </span>
                <span className={sty.c222d138}><span className={s.cls}>{s.label}</span></span>
              </button>
              </Fragment>
            );
          })}
        </div>
        {!jobs.length && (
          <div className={sty.c9c9e240}>
            Под фильтр ничего не попало — снимите «сегодня и завтра», порог оплаты или расстояние в панели фильтров сверху.
          </div>
        )}
      </div>
    </div>
  );
}
