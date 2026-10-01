'use client';

// Левая панель без выбранного заказа: гостю — «Как это работает», вошедшим — «Смена/Заказ за три шага».
import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';
import { css } from '@/lib/css';
import { Corners, LABEL } from './ui';
import sty from './RailSummary.module.css';

const GUIDE = {
  freelancer: {
    title: 'Подработка рядом — без резюме',
    lead: 'На карте — разовые заказы от городских подрядчиков и частных лиц. На каждой метке видны ставка и тип работы.',
    steps: [
      'Выберите метку на карте — слева откроются условия смены и оплата.',
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
      'Создайте профиль работодателя — имя, телефон и город.',
      'Щёлкните по карте или найдите адрес — укажите тип работы, дату, объём и оплату.',
      'Выберите исполнителя из откликов — откроется чат. После работы примите её и оцените.'
    ],
    note: 'Посмотреть, какие заказы уже есть в вашем районе, можно без регистрации.',
    cta: 'Создать профиль работодателя'
  }
};

export function GuestGuide() {
  const [who, setWho] = useState<'freelancer' | 'employer'>('freelancer');
  const g = GUIDE[who];
  const tab = (id: 'freelancer' | 'employer', label: string) => (
    <button role="tab" aria-selected={who === id} onClick={() => setWho(id)}
      style={css('cursor: pointer; border: 0; padding: 7px 6px; font-family: var(--font-heading); font-weight: 600; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; ' +
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
        <div className={sty.caf4ed04}>
          {g.steps.map((t, i) => (
            <div key={i} className={sty.c6776925}>
              <div className={'fh ' + sty.c0422fe0}>0{i + 1}</div>
              <div className={sty.c5d0b7df}>{t}</div>
            </div>
          ))}
        </div>
        <div className={sty.cf7a0fd3}>{g.note}</div>
        <Link href={'/auth?role=' + who} className={'btn btn-secondary btn-block ' + sty.cd488481}>{g.cta}</Link>
      </div>
      <div className={sty.c6840f0a}>
        <Link href="/auth" className={'btn btn-primary btn-block blueprint ' + sty.ccd64abd}><Corners />Зарегистрироваться</Link>
        <Link href="/auth?mode=login" className={'btn btn-secondary btn-block ' + sty.ccec5e2f}>Войти</Link>
        <div className={sty.c2d87e17}>Смотреть заказы можно без профиля — он нужен только для отклика.</div>
      </div>
    </div>
  );
}

export function StartSteps({ isEmp, addr }: {
  isEmp: boolean;
  addr?: { query: string; setQuery: (v: string) => void; busy: boolean; note: string; error: boolean; onFind: () => void };
}) {
  const steps = isEmp
    ? ['Щёлкните по карте или найдите адрес — откроется форма заказа.', 'Укажите тип работы, дату, объём и оплату. Условия видны исполнителю сразу.', 'Опубликуйте — исполнители откликнутся, их список появится в карточке заказа.']
    : ['Выберите метку на карте — слева откроются условия смены и оплата.', 'Откликнитесь. Профиль спросим только на этом шаге.', 'После найма откроются чат с работодателем и телефон встречающего.'];
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addr?.onFind(); } };
  return (
    <div>
      <div style={css(LABEL)}>Как это работает</div>
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
      <div className={sty.c9ccca91}>
        {isEmp
          ? 'Щёлкните по любой точке карты — откроется форма заказа: тип, адрес, дата, оплата и объём. Регион определится по метке. Чат с исполнителем открывается после найма.'
          : 'На карте у каждого заказа видна ставка и тип работы — выберите любую, чтобы прочитать условия и откликнуться. Чат открывается после найма.'}
      </div>
      {isEmp && addr && (
        <div className={sty.c4f7f1ad}>
          <div style={css(LABEL + '; margin-bottom: 10px')}>Заказ по адресу</div>
          <div className={sty.cfabd50d}>
            <input className={'input ' + sty.c8b4ab7f} aria-label="Адрес заказа" value={addr.query} onChange={e => addr.setQuery(e.target.value)} onKeyDown={onKey} placeholder="Москва, ул. Тверская, 18" />
            <button className={'btn btn-primary ' + sty.c6afc525} onClick={addr.onFind} disabled={addr.busy}>{addr.busy ? '…' : 'Найти'}</button>
          </div>
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; color: ' + (addr.error ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 66%, transparent)'))}>{addr.note}</div>
        </div>
      )}
    </div>
  );
}
