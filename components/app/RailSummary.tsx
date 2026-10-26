'use client';

// Левая панель без выбранного заказа: гостю — «Как это работает», вошедшим — «Смена/Заказ за три шага».
import Link from 'next/link';
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { css } from '@/lib/css';
import { TypeSearch, type JobTypeRow } from './FiltersPanel';
import { Corners, LABEL } from './ui';
import sty from './RailSummary.module.css';

const GUIDE = {
  freelancer: {
    title: 'Подработка рядом — без резюме',
    lead: 'На карте — разовые заказы от городских подрядчиков и частных лиц. На каждой метке видны ставка и тип работы.',
    steps: [
      'Выберите метку на карте — откроются условия смены и оплата.',
      'Откликнитесь. Профиль спросим только на этом шаге.',
      'После найма откроются чат с работодателем и телефон встречающего.'
    ],
    note: 'Смотреть заказы можно без регистрации — профиль нужен только для отклика.',
    cta: 'Создать профиль исполнителя'
  },
  employer: {
    title: 'Люди на смену — за день',
    lead: 'Опубликуйте заказ точкой на карте — его увидят исполнители поблизости. Ставка, дата и условия видны сразу, лишних вопросов меньше.',
    steps: [
      'Создайте профиль работодателя — имя, почта и город.',
      'Нажмите на карту или найдите адрес — укажите тип работы, дату, объём и оплату.',
      'Выберите исполнителя из откликов — откроется чат. После работы примите её и оцените.'
    ],
    note: 'Посмотреть, какие заказы уже есть в вашем районе, можно без регистрации.',
    cta: 'Создать профиль работодателя'
  }
};

export function GuestGuide() {
  const [who, setWho] = useState<'freelancer' | 'employer'>('freelancer');
  // Телефон: три шага свёрнуты — под картой остаются заголовок, пара строк и кнопка профиля.
  const [more, setMore] = useState(false);
  const g = GUIDE[who];
  const tab = (id: 'freelancer' | 'employer', label: string) => (
    <button role="tab" aria-selected={who === id} onClick={() => setWho(id)}
      style={css('cursor: pointer; border: 0; padding: 7px 6px; min-height: 40px; font-family: var(--font-heading); font-weight: 600; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; ' +
        (who === id ? 'background: var(--color-accent-100); color: var(--color-accent-900)' : 'background: transparent; color: var(--color-accent-100)'))}>{label}</button>
  );
  return (
    <div>
      <div className={sty.ca47e764}>
        <div className={'fh ' + sty.ca358a57}>Как это работает</div>
        <div role="tablist" className={sty.c47654df}>
          {tab('freelancer', 'Ищу работу')}{tab('employer', 'Нанимаю')}
        </div>
        <div className={'fh ' + sty.cc1bc816}>{g.title}</div>
        <div className={sty.c5cc1dcf}>{g.lead}</div>
        <button className={'only-narrow ' + sty.moreBtn} onClick={() => setMore(m => !m)} aria-expanded={more}>
          {more ? 'Свернуть ▴' : 'Как это работает — 3 шага ▾'}
        </button>
        <div className={more ? '' : sty.foldNarrow}>
          <div className={sty.caf4ed04}>
            {g.steps.map((t, i) => (
              <div key={i} className={sty.c6776925}>
                <div className={'fh ' + sty.c0422fe0}>0{i + 1}</div>
                <div className={sty.c5d0b7df}>{t}</div>
              </div>
            ))}
          </div>
          <div className={sty.cf7a0fd3}>{g.note}</div>
        </div>
        <Link href={'/auth?role=' + who} className={'btn btn-secondary btn-block ' + sty.cd488481}>{g.cta}</Link>
      </div>
    </div>
  );
}

/** Гостю под картой: виды подработки ссылками на их страницы — и людям, и поисковикам путь к каталогу. */
/**
 * «Какая работа?» на главной: поиск по видам работ (и по тому, как их называют, и по своим видам работодателей)
 * сразу фильтрует карту — раньше здесь был длинный список ссылок. Каталог по видам и городам — ссылкой ниже.
 */
export function WorkLinks({ types, value, onChange, found, n, onList }: {
  types: JobTypeRow[]; value: string[]; onChange: (ids: string[]) => void; found: string; n: number; onList: () => void;
}) {
  return (
    <section aria-label="Подработка по видам работ" className={sty.workLinks}>
      <div style={css(LABEL)}>Подработка по видам работ</div>
      <div className={sty.workSearch}>
        <TypeSearch types={types} value={value} onChange={onChange} label="Какую работу ищете" placeholder="Какая работа? Например: снег, грузчик, покос" />
      </div>
      {value.length > 0 && (n > 0 ? (
        <p className={sty.workFound}>
          На карте — только {value.length > 1 ? 'эти виды' : 'этот вид'}: найдено {found}.{' '}
          <button type="button" className={sty.workList} onClick={onList}>Показать списком</button>
        </p>
      ) : (
        // Таких заказов сейчас нет — не тупик: они появляются в сезон, о новых рядом можно узнавать первым.
        <p className={sty.workFound}>
          Сейчас таких заказов нет — они появляются в сезон, часто за день до выхода.{' '}
          <Link href="/auth?role=freelancer" className={sty.workList}>Создайте профиль</Link> — о новых рядом придёт уведомление.
        </p>
      ))}
      <Link href="/raboty" className={sty.workAll}>Все виды работ и города →</Link>
    </section>
  );
}

// «Как это работает» вошедшему нужен один раз: «Понятно» скрывает подсказку (запоминается в браузере).
const HIDE_KEY = 'arena.stepsHidden';
const onHideChange = (cb: () => void) => { window.addEventListener('arena:steps', cb); return () => window.removeEventListener('arena:steps', cb); };
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const setHidden = (on: boolean) => {
  try { if (on) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* приватный режим */ }
  window.dispatchEvent(new Event('arena:steps'));
};

export function StartSteps({ isEmp, addr }: {
  isEmp: boolean;
  addr?: { query: string; setQuery: (v: string) => void; busy: boolean; note: string; error: boolean; onFind: () => void };
}) {
  const steps = isEmp
    ? ['Нажмите на карту или найдите адрес — откроется форма заказа.', 'Укажите тип работы, дату, объём и оплату. Условия видны исполнителю сразу.', 'Опубликуйте — исполнители откликнутся, их список появится в карточке заказа.']
    : ['Выберите метку на карте — откроются условия смены и оплата.', 'Откликнитесь. Профиль спросим только на этом шаге.', 'После найма откроются чат с работодателем и телефон встречающего.'];
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addr?.onFind(); } };
  const hidden = useSyncExternalStore(onHideChange, readHidden, () => false);
  return (
    <div>
      {isEmp && addr && (
        <div className={sty.c4f7f1ad}>
          <div style={css(LABEL + '; margin-bottom: 10px')}>Новый заказ</div>
          <div className={sty.cfabd50d}>
            <input className={'input ' + sty.c8b4ab7f} aria-label="Адрес заказа" value={addr.query} onChange={e => addr.setQuery(e.target.value)} onKeyDown={onKey} placeholder="Москва, ул. Тверская, 18" />
            <button className={'btn btn-primary ' + sty.c6afc525} onClick={addr.onFind} disabled={addr.busy}>{addr.busy ? '…' : 'Найти'}</button>
          </div>
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; color: ' + (addr.error ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 66%, transparent)'))}>{addr.note}</div>
        </div>
      )}
      {hidden ? (
        <button className={'btn btn-ghost ' + sty.howAgain} onClick={() => setHidden(false)}>Как это работает?</button>
      ) : <>
      <div className={sty.howHead + (isEmp && addr ? ' ' + sty.howHeadGap : '')}>
        <div style={css(LABEL)}>Как это работает</div>
        <button className={'btn btn-ghost ' + sty.howHide} onClick={() => setHidden(true)}>Скрыть</button>
      </div>
      <div className={'fh ' + sty.ce15ec2e}>{isEmp ? 'Заказ за три шага' : 'Смена за три шага'}</div>
      <div className={sty.cd8f77ee}>
        {steps.map((t, i) => (
          <div key={i} className={'blueprint ' + sty.c3213d46}>
            <Corners />
            <div className={'fh ' + sty.cb087dd1}>0{i + 1}</div>
            <div className={sty.c5d0b7df}>{t}</div>
          </div>
        ))}
      </div>
      <div className={'only-wide ' + sty.c9ccca91}>
        {isEmp
          ? 'Нажмите на любую точку карты — откроется форма заказа: тип, адрес, дата, оплата и объём. Регион определится по метке. Чат с исполнителем открывается после найма.'
          : 'На карте у каждого заказа видна ставка и тип работы — выберите любую, чтобы прочитать условия и откликнуться. Чат открывается после найма.'}
      </div>
      </>}
    </div>
  );
}
