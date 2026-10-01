'use client';

// Форма заказа: 4 шага (Место → Работа → Деньги и время → Доступ), проверка по шагам, календарь с «Сегодня/Завтра».
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { MONTHS_GEN, PAY_TYPES, REPEATS, TOOLS, UNITS } from '@/lib/catalog';
import { css } from '@/lib/css';
import { localISO, type JobForm } from '@/lib/jobs';
import { ALERT, Corners, errFieldStyle, FIELD_ERR, LABEL, optStyle } from './ui';
import type { JobTypeRow } from './FiltersPanel';
import sty from './JobFormPanel.module.css';

const STEP_NAMES = ['Место', 'Работа', 'Деньги и время', 'Доступ'];

function FieldError({ text }: { text?: string }) {
  return text ? <div role="alert" style={css(FIELD_ERR)}>{text}</div> : null;
}

function DatePicker({ value, onPick, error }: { value: string; onPick: (iso: string) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const todayISO = localISO(now);
  const selD = value ? new Date(value + 'T00:00:00') : null;
  const base = month ? new Date(month + 'T00:00:00') : new Date((selD || now).getFullYear(), (selD || now).getMonth(), 1);
  const y = base.getFullYear(), m = base.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const len = new Date(y, m + 1, 0).getDate();
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const pick = (v: string) => { onPick(v); setOpen(false); };
  const cell = 'height: 36px; border: 1px solid transparent; background: transparent; font: inherit; font-size: 14px; color: var(--color-text); cursor: pointer; border-radius: 0';
  const days: ReactNode[] = [];
  for (let i = 0; i < lead; i++) days.push(<span key={'e' + i} />);
  for (let d = 1; d <= len; d++) {
    const v = localISO(new Date(y, m, d));
    const past = v < todayISO, on = v === value, isT = v === todayISO;
    days.push(
      <button key={v} type="button" disabled={past} onClick={() => pick(v)} aria-label={d + ' ' + MONTHS_GEN[m]} aria-pressed={on}
        style={css(cell + (on ? '; background: var(--color-accent); color: #fff' : isT ? '; border-color: var(--color-accent)' : '') + (past ? '; opacity: .35; cursor: default' : ''))}>{d}</button>
    );
  }
  return (
    <div className="field">
      <label>Дата выхода</label>
      <button type="button" className="input" onClick={() => { setOpen(o => !o); setMonth(null); }} aria-expanded={open}
        style={css('display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; cursor: pointer' + (selD ? '' : '; color: color-mix(in srgb, var(--color-text) 55%, transparent)') + (error ? '; ' + errFieldStyle : ''))}>
        <span>{selD ? selD.getDate() + ' ' + MONTHS_GEN[selD.getMonth()] + ' ' + selD.getFullYear() + ', ' + WD[selD.getDay()] : 'Выберите дату'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </button>
      {open && (
        <div className={sty.c90fa1bc}>
          <div className={sty.c9e79b66}>
            <button type="button" className={'btn btn-ghost ' + sty.c9e5a7ac} onClick={() => setMonth(localISO(new Date(y, m - 1, 1)))} disabled={y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())} aria-label="Предыдущий месяц">‹</button>
            <span className={'fh ' + sty.c22e630a}>{MONTHS[m]} {y}</span>
            <button type="button" className={'btn btn-ghost ' + sty.c9e5a7ac} onClick={() => setMonth(localISO(new Date(y, m + 1, 1)))} aria-label="Следующий месяц">›</button>
          </div>
          <div className={sty.ca41983f}>
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className={sty.cb6d184b}>{days}</div>
          <div className={sty.cb724174}>
            <button type="button" className={'btn btn-secondary ' + sty.cf221663} onClick={() => pick(todayISO)}>Сегодня</button>
            <button type="button" className={'btn btn-secondary ' + sty.cf221663} onClick={() => pick(localISO(tm))}>Завтра</button>
          </div>
        </div>
      )}
      <FieldError text={error} />
    </div>
  );
}

export function JobFormPanel({ form, setForm, step, goStep, errs, formError, onNext, onBack, onClose, types, addrNote, onAddrBlur, busy, editing, narrow }: {
  form: JobForm;
  setForm: (patch: Partial<JobForm>, clearErr?: string) => void;
  step: number;
  goStep: (n: number) => void;
  errs: Record<string, string>;
  formError: string;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  types: JobTypeRow[];
  addrNote: string;
  onAddrBlur: () => void;
  busy: boolean;
  editing: boolean;
  narrow: boolean;
}) {
  const [accessDraft, setAccessDraft] = useState('');
  const addAccess = () => {
    const v = accessDraft.trim().replace(/\s+/g, ' ');
    if (!v) return;
    setForm({ access: form.access.some(x => x.toLowerCase() === v.toLowerCase()) ? form.access : form.access.concat([v]) }, 'access');
    setAccessDraft('');
  };
  const onAccessKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addAccess(); } };
  const refTypes = types.filter(t => !t.custom);

  return (
    <div data-order-form="">
      <div className={sty.cf5c1e62}>
        <div style={css(LABEL)}>{editing ? 'Правка заказа' : 'Новый заказ'}{narrow ? '' : ' · ' + step + ' / 4'}</div>
        <button className={'btn btn-ghost ' + sty.c4b8d758} onClick={onClose}>Закрыть</button>
      </div>
      <div className={sty.cd524503}>
        {STEP_NAMES.map((label, i) => {
          const n = i + 1, done = n < step, active = n === step;
          return (
            <button key={label} onClick={() => goStep(n)} aria-current={active ? 'step' : undefined}
              style={css('flex: 1 1 0; min-width: 0; cursor: pointer; text-align: left; padding: 7px 9px 8px; background: ' + (active ? 'var(--color-accent)' : 'transparent') +
                '; border: 1px solid ' + (active || done ? 'var(--color-accent)' : 'var(--color-divider)') +
                '; color: ' + (active ? '#fff' : done ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 55%, transparent)') +
                '; font-family: var(--font-heading); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; line-height: 1.25; display: block')}>0{n} {label}</button>
          );
        })}
      </div>

      <div className={sty.c2fdf124}>
        {step === 1 && (
          <div className="field">
            <label htmlFor="jf-address">Адрес объекта</label>
            <input id="jf-address" className="input" value={form.address} onChange={e => setForm({ address: e.target.value }, 'address')} onBlur={onAddrBlur}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddrBlur(); } }} placeholder="ул. Тверская, 18" style={css(errs.address ? errFieldStyle : '')} />
            <FieldError text={errs.address} />
            <div className={sty.c598668c}>
              {addrNote || ((form.district ? form.district + ' · ' : '') + (form.lat != null ? 'метка стоит на карте, её можно переставить кликом' : 'введите адрес или кликните по карте — там встанет метка'))}
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div style={css(errs.type ? errFieldStyle + '; padding: 8px' : '')}>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Тип работы</div>
              <div className={sty.c9eb4a0d}>
                {refTypes.map(t => (
                  <button key={t.id} type="button" aria-pressed={form.type === t.id} onClick={() => setForm({ type: form.type === t.id ? '' : t.id, typeOther: '' }, 'type')} style={css(optStyle(form.type === t.id))}>{t.label}</button>
                ))}
              </div>
              <input className={'input ' + sty.ccfee772} value={form.typeOther} onChange={e => setForm({ typeOther: e.target.value, type: e.target.value.trim() ? '' : form.type }, 'type')}
                aria-label="Свой тип работы" placeholder="или впишите свой тип работы" />
              <FieldError text={errs.type} />
            </div>
            <div className="field">
              <label htmlFor="jf-desc">Что нужно сделать</label>
              <textarea id="jf-desc" className="input" rows={3} value={form.desc} onChange={e => setForm({ desc: e.target.value }, 'desc')} placeholder="Двор 320 м², инвентарь свой, вывоз не нужен" style={css(errs.desc ? errFieldStyle : '')} />
              <FieldError text={errs.desc} />
            </div>
            <div className={sty.c1f5724b}>
              <div className="field">
                <label htmlFor="jf-volume">Объём работ</label>
                <input id="jf-volume" className="input" value={form.volume} onChange={e => setForm({ volume: e.target.value })} placeholder="4–5 часов" />
              </div>
              <div className="field">
                <label htmlFor="jf-crew">Людей в смене</label>
                <input id="jf-crew" className="input" type="number" min={1} max={12} value={form.crew === '99' ? '' : form.crew} disabled={form.crew === '99'}
                  onChange={e => setForm({ crew: e.target.value.replace(/\D/g, '').slice(0, 2) }, 'crew')} placeholder={form.crew === '99' ? 'любое' : '1'} style={css(errs.crew ? errFieldStyle : '')} />
                <label className={sty.c3da639b}>
                  <input type="checkbox" checked={form.crew === '99'} onChange={e => setForm({ crew: e.target.checked ? '99' : '1' }, 'crew')} className={sty.cbbfb686} />
                  сколько угодно
                </label>
                <FieldError text={errs.crew} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="jf-req">Своё условие для отклика (необязательно)</label>
              <input id="jf-req" className="input" value={form.req} onChange={e => setForm({ req: e.target.value })} placeholder="нужна санкнижка / права категории B" />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className={sty.c8e0de12}>
              <div className="field">
                <label htmlFor="jf-pay">Оплата, ₽</label>
                <input id="jf-pay" className="input" inputMode="numeric" value={form.pay} onChange={e => {
                  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
                  setForm({ pay: d ? Number(d).toLocaleString('ru-RU') : '' }, 'pay');
                }} placeholder="6 000" style={css(errs.pay ? errFieldStyle : '')} />
                <FieldError text={errs.pay} />
              </div>
              <div className="field">
                <label htmlFor="jf-unit">За что</label>
                <select id="jf-unit" className="input" value={form.unit} onChange={e => setForm({ unit: e.target.value }, 'unit')}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="jf-paytype">Способ оплаты</label>
              <select id="jf-paytype" className="input" value={form.payType} onChange={e => setForm({ payType: e.target.value })}>
                {PAY_TYPES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <DatePicker value={form.dateISO} onPick={v => setForm({ dateISO: v }, 'date')} error={errs.date} />
            <label className={sty.c78f23aa}>
              <input type="checkbox" checked={form.urgent} onChange={e => setForm({ urgent: e.target.checked })} className={sty.ca42a1ef} />
              Срочный заказ — выход сегодня или завтра
            </label>
            <label className={sty.c78f23aa}>
              <input type="checkbox" checked={form.regular} onChange={e => setForm({ regular: e.target.checked }, 'repeat')} className={sty.ca42a1ef} />
              Повторять — серия смен
            </label>
            {form.regular && (
              <div className="field">
                <label htmlFor="jf-repeat">График</label>
                <select id="jf-repeat" className="input" value={form.repeat} onChange={e => setForm({ repeat: e.target.value }, 'repeat')} style={css(errs.repeat ? errFieldStyle : '')}>
                  <option value="">— выберите график —</option>
                  {REPEATS.map(r => <option key={r}>{r}</option>)}
                </select>
                <input className={'input ' + sty.c0d69e4b} aria-label="График — время и условия" value={form.repeatNote} onChange={e => setForm({ repeatNote: e.target.value })} placeholder="время и условия, напр. с 7:00, пока лежит снег" />
                <FieldError text={errs.repeat} />
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div style={css(errs.access ? errFieldStyle + '; padding: 8px' : '')}>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Как попасть на объект</div>
              <div className={sty.cfabd50d}>
                <input className={'input ' + sty.c8b4ab7f} value={accessDraft} onChange={e => setAccessDraft(e.target.value)} onKeyDown={onAccessKey} aria-label="Доступ на объект" placeholder="домофон 12, шлагбаум открыт до 9:00" />
                <button type="button" className={'btn btn-secondary ' + sty.c0b0526d} onClick={addAccess} disabled={!accessDraft.trim()}>Добавить</button>
              </div>
              {form.access.length > 0 && (
                <div className={sty.c520f760}>
                  {form.access.map(a => (
                    <button key={a} type="button" className={'tag tag-accent ' + sty.c4008c14} title="Убрать" onClick={() => setForm({ access: form.access.filter(x => x !== a) })}>✓ {a}</button>
                  ))}
                </div>
              )}
              <FieldError text={errs.access} />
            </div>
            <div>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Инвентарь</div>
              <div className={sty.c9dde168}>
                {TOOLS.map(t => {
                  const on = form.tools === t;
                  return (
                    <button key={t} type="button" aria-pressed={on} onClick={() => setForm({ tools: t }, 'tools')}
                      style={css('display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer; font-family: var(--font-body); font-size: 14px; padding: 9px 11px; border: 1px solid ' +
                        (on ? 'var(--color-accent)' : 'var(--color-divider)') + '; background: ' + (on ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent') +
                        '; color: ' + (on ? 'var(--color-accent-900)' : 'var(--color-text)') + (errs.tools ? '; ' + errFieldStyle : ''))}>
                      <span>{on ? '◉' : '○'}</span><span>{t}</span>
                    </button>
                  );
                })}
              </div>
              <FieldError text={errs.tools} />
            </div>
            <div className={sty.cabb3d2f}>
              <div className="field">
                <label htmlFor="jf-meet">Кто встречает на объекте</label>
                <input id="jf-meet" className="input" value={form.meetName} onChange={e => setForm({ meetName: e.target.value })} placeholder="я сам / Марат, старший по дому" />
              </div>
              <div className="field">
                <label htmlFor="jf-meetphone">Телефон встречающего</label>
                <input id="jf-meetphone" className="input" type="tel" value={form.meetPhone} onChange={e => setForm({ meetPhone: e.target.value }, 'meetPhone')} placeholder="+7 900 000-00-00" style={css(errs.meetPhone ? errFieldStyle : '')} />
                <FieldError text={errs.meetPhone} />
              </div>
            </div>
            <div className={sty.c781cdc9}>Телефон встречающего увидит только нанятый исполнитель. Адрес, доступ и инвентарь видны в карточке сразу.</div>
          </>
        )}
      </div>

      {formError && <div role="alert" style={css(ALERT)}>{formError}</div>}
      <div className={sty.ca27aaae}>
        {step > 1 && <button className={'btn btn-secondary ' + sty.c61fef2d} onClick={onBack}>Назад</button>}
        <button className={'btn btn-primary blueprint ' + sty.c0dd5712} onClick={onNext} disabled={busy}>
          <Corners />{step === 4 ? (editing ? 'Сохранить изменения' : 'Опубликовать смену') : 'Далее'}
        </button>
      </div>
    </div>
  );
}
