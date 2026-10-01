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
import sty from './ReviewModal.module.css';

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
    <div className={sty.c0b95095} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <div onClick={close} className={sty.ccd59aab} />
      <div className={'blueprint ' + sty.c28112cd} role="dialog" aria-modal="true" aria-label="Отзыв о работе">
        <Corners />
        <div className={'fh ' + sty.c4afa4c3}>Отзыв о работе</div>
        <div className={'fh ' + sty.c8d769bb}>{review.name}</div>
        <div className={sty.c6666a72}>{review.title}</div>
        <div role="radiogroup" aria-label="Оценка" className={sty.cf65377f}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)}
              style={css('width: 40px; height: 42px; cursor: pointer; font-family: var(--font-heading); font-size: 15px; border: 1px solid ' + (rating >= n ? 'var(--color-accent)' : 'var(--color-divider)') +
                '; background: ' + (rating >= n ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent') +
                '; color: ' + (rating >= n ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 66%, transparent)'))}>{n}</button>
          ))}
        </div>
        <textarea className={'input ' + sty.c04583f7} rows={3} value={text} onChange={e => setText(e.target.value)} aria-label="Отзыв" placeholder="Пришёл вовремя, двор чистый, фото прислал сам" />
        <div className={sty.cda9536f}>Отзыв виден в профиле второй стороны и влияет на рейтинг. Исправить или удалить его можно в течение 10 минут.</div>
        {error && <div role="alert" className={sty.c4ee8292}>{error}</div>}
        <div className={sty.c5c223c4}>
          <button className={'btn btn-primary ' + sty.ca96b295} onClick={() => submit()} disabled={busy}>{review.rating ? 'Сохранить отзыв' : 'Отправить отзыв'}</button>
          {review.rating ? <button className={'btn btn-ghost ' + sty.c308e88a} onClick={() => submit(true)} disabled={busy}>Удалить</button> : null}
          <button className={'btn btn-ghost ' + sty.c308e88a} onClick={close}>Позже</button>
        </div>
      </div>
    </div>
  );
}
