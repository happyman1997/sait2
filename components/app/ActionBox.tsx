'use client';

// «Сейчас важно»: что ждёт действия вошедшего — разобрать отклики, принять сданную работу, выйти на смену, оставить отзыв.
// Стоит над подсказками на главной: после найма или сдачи работы человек сразу видит, куда нажать.
import Link from 'next/link';
import { dateLabel, daysAhead, jobNum, plural } from '@/lib/jobs';
import { useLive } from './Live';
import sty from './ActionBox.module.css';

type Item = { key: string; text: string; href: string; cta: string };

export function ActionBox() {
  const { me, todo } = useLive();
  if (!me) return null;
  const when = (d: string) => {
    const n = daysAhead(d);
    return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n != null && n < 0 ? dateLabel(d) + ' — пора сдать работу' : dateLabel(d);
  };
  const items: Item[] = [
    ...todo.reported.map(j => ({ key: 'r' + j.num, text: 'Работа сдана · заказ № ' + jobNum(j.num) + ' «' + j.title + '»', href: '/shift?job=' + j.num, cta: 'Проверить и принять' })),
    ...(todo.apps > 0 ? [{ key: 'apps', text: todo.apps + ' ' + plural(todo.apps, 'отклик ждёт', 'отклика ждут', 'откликов ждут') + ' решения', href: '/apps', cta: 'Отклики' }] : []),
    ...(todo.shift ? [{ key: 's', text: (todo.shift.date ? 'Смена ' + when(todo.shift.date) : 'Смена по вызову') + ' · «' + todo.shift.title + '»', href: '/shift?job=' + todo.shift.num, cta: 'Экран смены' }] : []),
    ...todo.reviews.map(j => ({ key: 'v' + j.num, text: 'Оцените ' + (me.role === 'employer' ? 'исполнителя' : 'работодателя') + ' · заказ № ' + jobNum(j.num), href: '/?job=' + j.num, cta: 'Оставить отзыв' }))
  ].slice(0, 3);
  if (!items.length) return null;
  return (
    <section className={sty.box} aria-label="Сейчас важно">
      <div className={sty.head}>Сейчас важно</div>
      {items.map(i => (
        <div key={i.key} className={sty.row}>
          <div className={sty.text}>{i.text}</div>
          <Link href={i.href} className={'btn btn-primary ' + sty.cta}>{i.cta}</Link>
        </div>
      ))}
    </section>
  );
}
