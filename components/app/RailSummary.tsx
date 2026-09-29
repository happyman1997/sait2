'use client';

// Левая панель без выбранного заказа: гостю — «Как это работает», вошедшим — «Смена/Заказ за три шага».
import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';
import { css } from '@/lib/css';
import { Corners, LABEL } from './ui';

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
      <div style={css('background: var(--color-accent-700); color: var(--color-accent-100); padding: 14px; margin: -4px')}>
        <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--color-accent-200)')}>Как это работает</div>
        <div role="tablist" style={css('display: grid; grid-template-columns: 1fr 1fr; gap: 2px; margin-top: 10px; padding: 2px; border: 1px solid var(--color-accent-500)')}>
          {tab('freelancer', 'Ищу работу')}{tab('employer', 'Нанимаю')}
        </div>
        <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 25px; line-height: 1.05; text-transform: uppercase; letter-spacing: .02em; margin-top: 14px')}>{g.title}</div>
        <div style={css('font-size: 13.5px; line-height: 1.45; margin-top: 8px; color: var(--color-accent-200); text-wrap: pretty')}>{g.lead}</div>
        <div style={css('display: grid; gap: 12px; margin-top: 16px')}>
          {g.steps.map((t, i) => (
            <div key={i} style={css('display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 9px; align-items: start')}>
              <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 12px; letter-spacing: .14em; color: var(--color-accent-200); padding-top: 2px')}>0{i + 1}</div>
              <div style={css('font-size: 13.5px; line-height: 1.45; text-wrap: pretty')}>{t}</div>
            </div>
          ))}
        </div>
        <div style={css('font-size: 12.5px; line-height: 1.45; margin-top: 12px; color: var(--color-accent-200); text-wrap: pretty')}>{g.note}</div>
        <Link href={'/auth?role=' + who} className="btn btn-secondary btn-block" style={css('margin-top: 12px; height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; background: var(--color-accent-100); color: var(--color-accent-900); border-color: var(--color-accent-100)')}>{g.cta}</Link>
      </div>
      <div style={css('margin-top: 18px')}>
        <Link href="/auth" className="btn btn-primary btn-block blueprint" style={css('height: 58px; font-size: 16px; letter-spacing: .08em; text-transform: uppercase')}><Corners />Зарегистрироваться</Link>
        <Link href="/auth?mode=login" className="btn btn-secondary btn-block" style={css('margin-top: 8px; height: 46px; font-size: 14px; letter-spacing: .06em; text-transform: uppercase')}>Войти</Link>
        <div style={css('font-size: 13px; line-height: 1.45; margin-top: 8px; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>Смотреть заказы можно без профиля — он нужен только для отклика.</div>
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
      <div style={css('font-family: var(--font-heading); font-weight: 600; font-size: 27px; line-height: 1.1; text-transform: uppercase; letter-spacing: .02em; margin: 4px 0 12px')}>{isEmp ? 'Заказ за три шага' : 'Смена за три шага'}</div>
      <div style={css('display: grid; gap: 10px; margin-bottom: 16px')}>
        {steps.map((t, i) => (
          <div key={i} className="blueprint" style={css('display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; padding: 12px 13px; align-items: start')}>
            <Corners />
            <div style={css('width: 30px; height: 30px; border-radius: 999px; background: var(--color-accent); color: #fff; display: grid; place-items: center; font-family: var(--font-heading); font-weight: 600; font-size: 15px; line-height: 1')}>0{i + 1}</div>
            <div style={css('font-size: 13.5px; line-height: 1.45; text-wrap: pretty')}>{t}</div>
          </div>
        ))}
      </div>
      <div style={css('font-size: 13.5px; line-height: 1.5; color: color-mix(in srgb, var(--color-text) 65%, transparent); text-wrap: pretty')}>
        {isEmp
          ? 'Щёлкните по любой точке карты — откроется форма заказа: тип, адрес, дата, оплата и объём. Регион определится по метке. Чат с исполнителем открывается после найма.'
          : 'На карте у каждого заказа видна ставка и тип работы — выберите любую, чтобы прочитать условия и откликнуться. Чат открывается после найма.'}
      </div>
      {isEmp && addr && (
        <div style={css('margin-top: 20px')}>
          <div style={css(LABEL + '; margin-bottom: 10px')}>Заказ по адресу</div>
          <div style={css('display: flex; gap: 6px')}>
            <input className="input" aria-label="Адрес заказа" value={addr.query} onChange={e => addr.setQuery(e.target.value)} onKeyDown={onKey} placeholder="Москва, ул. Тверская, 18" style={css('flex: 1; min-width: 0')} />
            <button className="btn btn-primary" onClick={addr.onFind} disabled={addr.busy} style={css('height: 42px; padding: 0 16px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap')}>{addr.busy ? '…' : 'Найти'}</button>
          </div>
          <div style={css('font-size: 13px; line-height: 1.4; margin-top: 8px; color: ' + (addr.error ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 66%, transparent)'))}>{addr.note}</div>
        </div>
      )}
    </div>
  );
}
