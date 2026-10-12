'use client';

// Отзывы об откликнувшемся — раскрываются в его карточке у работодателя заказа. Загружаются по нажатию;
// имён авторов нет, только оценка, текст, вид работ и дата.
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import sty from './ApplicantReviews.module.css';

type Review = { rating: number; text: string; at: string; work: string };

const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function ApplicantReviews({ num, appId, count }: { num: number; appId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Review[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  if (!count) return null;

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (list || loading) return;
    setLoading(true);
    setErr('');
    try {
      const r = await api<{ reviews: Review[]; total: number }>('/api/jobs/' + num + '/applicants/' + appId + '/reviews');
      setList(r.reviews);
      setTotal(r.total);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Не удалось загрузить отзывы — попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={sty.wrap}>
      <button type="button" className={'btn btn-ghost ' + sty.toggle} onClick={toggle} aria-expanded={open}>
        {open ? 'Скрыть отзывы' : 'Отзывы · ' + count}
      </button>
      {open && (
        <div className={sty.list}>
          {loading && <div className={sty.muted}>Загружаем отзывы…</div>}
          {err && <div role="alert" className={sty.error}>{err}</div>}
          {list?.map((r, i) => (
            <div key={i}>
              <div className={sty.head}>
                <span className={sty.stars} aria-label={'Оценка ' + r.rating + ' из 5'}>{'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}</span>
                <span className={sty.muted}>{r.work} · {day(r.at)}</span>
              </div>
              <div className={sty.text}>{r.text || 'Без комментария'}</div>
            </div>
          ))}
          {list && total > list.length && <div className={sty.muted}>Показаны последние {list.length} из {total}.</div>}
          {list && <div className={sty.note}>Отзывы оставили работодатели, у которых он работал; их имена не показываются.</div>}
        </div>
      )}
    </div>
  );
}
