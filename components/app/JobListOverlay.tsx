'use client';

// «Все заказы списком» — выезжающая слева панель с поиском.
import { css } from '@/lib/css';
import { dateLabel, jobNum, jobStatus, money, type JobSummary } from '@/lib/jobs';

export function JobListOverlay({ jobs, q, setQ, onClose, onOpen, onHover, role }: {
  jobs: JobSummary[]; q: string; setQ: (q: string) => void; onClose: () => void; onOpen: (num: number) => void;
  onHover: (num: number | null) => void; role: 'freelancer' | 'employer' | null;
}) {
  return (
    <div style={{ display: 'contents' }}>
      <div onClick={onClose} style={css('position: absolute; inset: 0; z-index: 70; background: rgba(24, 30, 36, .35)')} />
      <div role="dialog" aria-label="Заказы на карте" style={css('position: absolute; top: 0; left: 0; bottom: 0; z-index: 71; width: min(420px, 92vw); box-sizing: border-box; padding: 20px 18px 26px; overflow-y: auto; overflow-x: hidden; background: var(--color-neutral-100); border-right: 1px solid var(--color-accent); box-shadow: 0 0 60px rgba(20, 26, 32, .28)')}>
        <div style={css('display: flex; justify-content: space-between; align-items: baseline; gap: 10px')}>
          <div style={css('display: flex; align-items: baseline; gap: 9px; min-width: 0')}>
            <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>Заказы на карте</div>
            <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 24px; line-height: 1; color: var(--color-accent-900)')}>{jobs.length}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={css('height: 28px; font-size: 13px; flex: none')}>Закрыть</button>
        </div>
        <div style={css('display: flex; gap: 6px; align-items: center; margin-top: 12px')}>
          <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Поиск" placeholder="Поиск: тип работы, адрес, город" style={css('flex: 1; min-width: 0; height: 38px; min-height: 38px; font-size: 13px; padding: 0 10px')} />
          {q.trim() && <button className="btn btn-ghost" onClick={() => setQ('')} style={css('height: 38px; font-size: 13px; flex: none')}>Сброс</button>}
        </div>
        <div style={css('display: grid; gap: 8px; margin-top: 14px; min-width: 0')}>
          {jobs.map(j => {
            const s = jobStatus(j, role);
            return (
              <button key={j.num} onClick={() => onOpen(j.num)} onMouseEnter={() => onHover(j.num)} onMouseLeave={() => onHover(null)} className="job-row"
                style={css('min-width: 0; box-sizing: border-box; text-align: left; cursor: pointer; background: var(--color-bg); border: 1px solid var(--color-divider); padding: 13px 14px; font-family: var(--font-body); color: inherit')}>
                <span style={css('display: flex; justify-content: space-between; gap: 8px; align-items: baseline')}>
                  <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: 14px; letter-spacing: .16em; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>{jobNum(j.num)}</span>
                  <span style={css('font-family: var(--font-heading); font-weight: 600; font-size: 20px; white-space: nowrap; color: var(--color-accent-900)')}>{money(j.pay, j.unit)}</span>
                </span>
                <span style={css('display: block; font-family: var(--font-heading); font-weight: 600; font-size: 19px; line-height: 1.15; text-transform: uppercase; letter-spacing: .02em; margin-top: 5px')}>{j.title}</span>
                <span style={css('display: block; font-size: 14.5px; line-height: 1.4; margin-top: 4px; color: color-mix(in srgb, var(--color-text) 68%, transparent)')}>
                  {j.address} · {j.repeat ? 'с ' + dateLabel(j.date) : dateLabel(j.date)}{j.distanceKm != null ? ' · ' + (j.distanceKm < 10 ? j.distanceKm.toFixed(1) : Math.round(j.distanceKm)) + ' км' : ''}
                </span>
                <span style={css('display: block; margin-top: 7px')}><span className={s.cls}>{s.label}</span></span>
              </button>
            );
          })}
        </div>
        {!jobs.length && (
          <div style={css('font-size: 13px; line-height: 1.45; margin-top: 12px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>
            Под фильтр ничего не попало — снимите «сегодня и завтра», порог оплаты или расстояние в панели фильтров сверху.
          </div>
        )}
      </div>
    </div>
  );
}
