'use client';

// «Поделиться» в карточке заказа: Telegram, WhatsApp, ВКонтакте и ссылка. В превью ссылки мессенджер покажет
// картинку с оплатой, видом работ, местом и датой (server/og.tsx).
import { useState } from 'react';
import { useFlash } from '@/components/Toast';
import { css } from '@/lib/css';
import type { JobDetail } from '@/lib/jobs';
import { shareLinks, shareText, shareUsed } from '@/lib/share';
import { Corners, LABEL } from './ui';
import sty from './ShareJob.module.css';

const COLORS = { tg: '#229ed9', wa: '#25d366', vk: '#0077ff' };

export function ShareJob({ job, onClose }: { job: JobDetail; onClose: () => void }) {
  const flash = useFlash();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const url = location.origin + '/?job=' + job.num;
  const text = shareText(job);
  // Телефон: системное меню «Поделиться» — все остальные приложения (Max, почта, SMS).
  const native = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      shareUsed();
      setCopied(true); setManual(false);
      flash('Ссылка скопирована');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setManual(true);
    }
  };

  const more = () => navigator.share({ title: job.title, text, url }).then(shareUsed, () => {});

  return (
    <div className={'blueprint ' + sty.panel}>
      <Corners />
      <div className={sty.head}>
        <div style={css(LABEL)}>Поделиться заказом</div>
        <button className={'btn btn-ghost ' + sty.close} onClick={onClose} aria-label="Скрыть «Поделиться»">Скрыть</button>
      </div>
      <div className={sty.hint}>
        {job.mine ? 'Отправьте ссылку в чат дома, района или садового товарищества — соседи откликнутся быстрее.'
          : 'Знаете, кому подойдёт? Отправьте ссылку.'} В превью — оплата, место и дата.
      </div>
      <div className={sty.grid}>
        {shareLinks(url, text).map(l => (
          <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer" onClick={shareUsed} className={'btn btn-secondary ' + sty.item}>
            <span className={sty.dot} style={{ background: COLORS[l.id] }} aria-hidden="true" />{l.label}
          </a>
        ))}
        <button className={'btn btn-secondary ' + sty.item} onClick={copy}>
          <span className={sty.dot} style={{ background: 'var(--color-accent)' }} aria-hidden="true" />{copied ? 'Скопировано ✓' : 'Скопировать ссылку'}
        </button>
        {native && <button className={'btn btn-ghost ' + sty.item + ' ' + sty.wide} onClick={more}>Другие приложения…</button>}
      </div>
      {manual && (
        <div className={sty.manual}>
          <div className={sty.hint}>Не получилось скопировать автоматически — выделите ссылку и скопируйте:</div>
          <input className="input" readOnly value={url} data-nomod autoFocus onFocus={e => e.target.select()} aria-label="Ссылка на заказ" />
        </div>
      )}
    </div>
  );
}
