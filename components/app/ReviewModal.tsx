'use client';

// Окно «Отзыв о работе» (как в прототипе): оценка 1–5 и текст; 10 минут можно исправить или удалить.
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { css } from '@/lib/css';
import type { JobDetail } from '@/lib/jobs';
import { showModeration } from '@/components/ModerationGuard';
import { useFlash } from '@/components/Toast';
import { useLive } from './Live';
import { Corners } from './ui';

export function ReviewModal() {
  const { review, openReview } = useLive();
  const flash = useFlash();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (review) { setRating(review.rating ?? 5); setText(review.text ?? ''); setError(''); }
  }, [review]);

  if (!review) return null;
  const close = () => openReview(null);

  const submit = async (del = false) => {
    setBusy(true);
    try {
      const r = await api<{ job: JobDetail }>('/api/jobs/' + review.num + (del ? '/review/delete' : '/review'), { rating, text, target: review.target });
      review.onSaved?.(r.job);
      flash(del ? 'Отзыв удалён' : review.rating ? 'Отзыв исправлен' : 'Отзыв отправлен — 10 минут можно исправить');
      close();
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration('Отзыв', e.body.moderation.category, text);
      setError(e instanceof ApiError ? e.message : 'Отзыв не сохранился — попробуйте ещё раз');
    } finally { setBusy(false); }
  };

  return (
    <div style={css('position: fixed; inset: 0; z-index: 145; display: grid; place-items: center; padding: 20px; background: rgba(24, 30, 36, .48)')} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <div onClick={close} style={css('position: absolute; inset: 0')} />
      <div className="blueprint" role="dialog" aria-modal="true" aria-label="Отзыв о работе" style={css('position: relative; z-index: 146; width: min(440px, 94vw); padding: 20px 22px; background: var(--color-bg); box-shadow: 0 24px 60px rgba(20, 26, 32, .3)')}>
        <Corners />
        <div style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>Отзыв о работе</div>
        <div style={css('font-family: var(--font-heading); font-size: 22px; line-height: 1.05; text-transform: uppercase; letter-spacing: .02em; margin-top: 3px')}>{review.name}</div>
        <div style={css('font-size: 13.5px; line-height: 1.35; margin-top: 3px; color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>{review.title}</div>
        <div role="radiogroup" aria-label="Оценка" style={css('display: flex; gap: 5px; margin-top: 14px')}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)}
              style={css('width: 40px; height: 42px; cursor: pointer; font-family: var(--font-heading); font-size: 15px; border: 1px solid ' + (rating >= n ? 'var(--color-accent)' : 'var(--color-divider)') +
                '; background: ' + (rating >= n ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent') +
                '; color: ' + (rating >= n ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 66%, transparent)'))}>{n}</button>
          ))}
        </div>
        <textarea className="input" rows={3} value={text} onChange={e => setText(e.target.value)} aria-label="Отзыв" placeholder="Пришёл вовремя, двор чистый, фото прислал сам" style={css('width: 100%; box-sizing: border-box; margin-top: 12px')} />
        <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 8px; color: color-mix(in srgb, var(--color-text) 60%, transparent)')}>Отзыв виден в профиле второй стороны и влияет на рейтинг. Исправить или удалить его можно в течение 10 минут.</div>
        {error && <div role="alert" style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; color: var(--color-accent-900); border: 1px solid var(--color-accent); padding: 7px 9px')}>{error}</div>}
        <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
          <button className="btn btn-primary" onClick={() => submit()} disabled={busy} style={css('flex: 1; height: 42px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase')}>{review.rating ? 'Сохранить отзыв' : 'Отправить отзыв'}</button>
          {review.rating ? <button className="btn btn-ghost" onClick={() => submit(true)} disabled={busy} style={css('height: 42px; font-size: 13px')}>Удалить</button> : null}
          <button className="btn btn-ghost" onClick={close} style={css('height: 42px; font-size: 13px')}>Позже</button>
        </div>
      </div>
    </div>
  );
}
