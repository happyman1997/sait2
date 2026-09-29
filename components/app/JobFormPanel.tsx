'use client';

// Форма заказа: 4 шага (Место → Работа → Деньги и время → Доступ), проверка по шагам, календарь с «Сегодня/Завтра».
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { MONTHS_GEN, PAY_TYPES, REPEATS, TOOLS, UNITS } from '@/lib/catalog';
import { css } from '@/lib/css';
import { localISO, type JobForm } from '@/lib/jobs';
import { ALERT, Corners, errFieldStyle, FIELD_ERR, LABEL, optStyle } from './ui';
import type { JobTypeRow } from './FiltersPanel';

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
        <div style={css('margin-top: 6px; border: 1px solid var(--color-divider); background: var(--color-bg); padding: 10px; box-shadow: var(--shadow-md)')}>
          <div style={css('display: flex; align-items: center; gap: 6px')}>
            <button type="button" className="btn btn-ghost" onClick={() => setMonth(localISO(new Date(y, m - 1, 1)))} disabled={y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())} aria-label="Предыдущий месяц" style={css('width: 34px; height: 34px; padding: 0')}>‹</button>
            <span style={css('flex: 1; text-align: center; font-family: var(--font-heading); font-size: 15px; letter-spacing: .06em; text-transform: uppercase')}>{MONTHS[m]} {y}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setMonth(localISO(new Date(y, m + 1, 1)))} aria-label="Следующий месяц" style={css('width: 34px; height: 34px; padding: 0')}>›</button>
          </div>
          <div style={css('display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-top: 6px; font-size: 11.5px; text-align: center; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 58%, transparent)')}>
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div style={css('display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-top: 4px')}>{days}</div>
          <div style={css('display: flex; gap: 6px; margin-top: 8px')}>
            <button type="button" className="btn btn-secondary" onClick={() => pick(todayISO)} style={css('flex: 1; height: 34px; font-size: 13px')}>Сегодня</button>
            <button type="button" className="btn btn-secondary" onClick={() => pick(localISO(tm))} style={css('flex: 1; height: 34px; font-size: 13px')}>Завтра</button>
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
      <div style={css('display: flex; justify-content: space-between; align-items: baseline; gap: 10px')}>
        <div style={css(LABEL)}>{editing ? 'Правка заказа' : 'Новый заказ'}{narrow ? '' : ' · ' + step + ' / 4'}</div>
        <button className="btn btn-ghost" onClick={onClose} style={css('height: 28px; font-size: 13px')}>Закрыть</button>
      </div>
      <div style={css('display: flex; gap: 4px; margin-top: 10px')}>
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

      <div style={css('display: grid; gap: 14px; margin-top: 18px')}>
        {step === 1 && (
          <div className="field">
            <label htmlFor="jf-address">Адрес объекта</label>
            <input id="jf-address" className="input" value={form.address} onChange={e => setForm({ address: e.target.value }, 'address')} onBlur={onAddrBlur}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddrBlur(); } }} placeholder="ул. Тверская, 18" style={css(errs.address ? errFieldStyle : '')} />
            <FieldError text={errs.address} />
            <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 5px; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>
              {addrNote || ((form.district ? form.district + ' · ' : '') + (form.lat != null ? 'метка стоит на карте, её можно переставить кликом' : 'введите адрес или кликните по карте — там встанет метка'))}
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div style={css(errs.type ? errFieldStyle + '; padding: 8px' : '')}>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Тип работы</div>
              <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px')}>
                {refTypes.map(t => (
                  <button key={t.id} type="button" aria-pressed={form.type === t.id} onClick={() => setForm({ type: form.type === t.id ? '' : t.id, typeOther: '' }, 'type')} style={css(optStyle(form.type === t.id))}>{t.label}</button>
                ))}
              </div>
              <input className="input" value={form.typeOther} onChange={e => setForm({ typeOther: e.target.value, type: e.target.value.trim() ? '' : form.type }, 'type')}
                aria-label="Свой тип работы" placeholder="или впишите свой тип работы" style={css('margin-top: 8px; width: 100%; box-sizing: border-box')} />
              <FieldError text={errs.type} />
            </div>
            <div className="field">
              <label htmlFor="jf-desc">Что нужно сделать</label>
              <textarea id="jf-desc" className="input" rows={3} value={form.desc} onChange={e => setForm({ desc: e.target.value }, 'desc')} placeholder="Двор 320 м², инвентарь свой, вывоз не нужен" style={css(errs.desc ? errFieldStyle : '')} />
              <FieldError text={errs.desc} />
            </div>
            <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px')}>
              <div className="field">
                <label htmlFor="jf-volume">Объём работ</label>
                <input id="jf-volume" className="input" value={form.volume} onChange={e => setForm({ volume: e.target.value })} placeholder="4–5 часов" />
              </div>
              <div className="field">
                <label htmlFor="jf-crew">Людей в смене</label>
                <input id="jf-crew" className="input" type="number" min={1} max={12} value={form.crew === '99' ? '' : form.crew} disabled={form.crew === '99'}
                  onChange={e => setForm({ crew: e.target.value.replace(/\D/g, '').slice(0, 2) }, 'crew')} placeholder={form.crew === '99' ? 'любое' : '1'} style={css(errs.crew ? errFieldStyle : '')} />
                <label style={css('display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 6px; cursor: pointer; text-transform: none; letter-spacing: 0; font-family: var(--font-body); font-weight: 400')}>
                  <input type="checkbox" checked={form.crew === '99'} onChange={e => setForm({ crew: e.target.checked ? '99' : '1' }, 'crew')} style={css('width: 16px; height: 16px; accent-color: var(--color-accent)')} />
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
            <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px')}>
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
            <label style={css('display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer')}>
              <input type="checkbox" checked={form.urgent} onChange={e => setForm({ urgent: e.target.checked })} style={css('width: 18px; height: 18px; accent-color: var(--color-accent)')} />
              Срочный заказ — выход сегодня или завтра
            </label>
            <label style={css('display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer')}>
              <input type="checkbox" checked={form.regular} onChange={e => setForm({ regular: e.target.checked }, 'repeat')} style={css('width: 18px; height: 18px; accent-color: var(--color-accent)')} />
              Повторять — серия смен
            </label>
            {form.regular && (
              <div className="field">
                <label htmlFor="jf-repeat">График</label>
                <select id="jf-repeat" className="input" value={form.repeat} onChange={e => setForm({ repeat: e.target.value }, 'repeat')} style={css(errs.repeat ? errFieldStyle : '')}>
                  <option value="">— выберите график —</option>
                  {REPEATS.map(r => <option key={r}>{r}</option>)}
                </select>
                <input className="input" aria-label="График — время и условия" value={form.repeatNote} onChange={e => setForm({ repeatNote: e.target.value })} placeholder="время и условия, напр. с 7:00, пока лежит снег" style={css('margin-top: 8px')} />
                <FieldError text={errs.repeat} />
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div style={css(errs.access ? errFieldStyle + '; padding: 8px' : '')}>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Как попасть на объект</div>
              <div style={css('display: flex; gap: 6px')}>
                <input className="input" value={accessDraft} onChange={e => setAccessDraft(e.target.value)} onKeyDown={onAccessKey} aria-label="Доступ на объект" placeholder="домофон 12, шлагбаум открыт до 9:00" style={css('flex: 1; min-width: 0')} />
                <button type="button" className="btn btn-secondary" onClick={addAccess} disabled={!accessDraft.trim()} style={css('height: 40px; font-size: 13px; padding: 0 14px')}>Добавить</button>
              </div>
              {form.access.length > 0 && (
                <div style={css('display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px')}>
                  {form.access.map(a => (
                    <button key={a} type="button" className="tag tag-accent" title="Убрать" onClick={() => setForm({ access: form.access.filter(x => x !== a) })} style={css('cursor: pointer; border-width: 1px; border-style: solid')}>✓ {a}</button>
                  ))}
                </div>
              )}
              <FieldError text={errs.access} />
            </div>
            <div>
              <div style={css(LABEL + '; margin-bottom: 8px')}>Инвентарь</div>
              <div style={css('display: grid; gap: 6px')}>
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
            <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px')}>
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
            <div style={css('font-size: 13px; line-height: 1.45; color: color-mix(in srgb, var(--color-text) 68%, transparent)')}>Телефон встречающего увидит только нанятый исполнитель. Адрес, доступ и инвентарь видны в карточке сразу.</div>
          </>
        )}
      </div>

      {formError && <div role="alert" style={css(ALERT)}>{formError}</div>}
      <div style={css('display: flex; gap: 8px; margin-top: 20px')}>
        {step > 1 && <button className="btn btn-secondary" onClick={onBack} style={css('height: 46px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; padding: 0 18px')}>Назад</button>}
        <button className="btn btn-primary blueprint" onClick={onNext} disabled={busy} style={css('flex: 1; position: relative; height: 46px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase')}>
          <Corners />{step === 4 ? (editing ? 'Сохранить изменения' : 'Опубликовать смену') : 'Далее'}
        </button>
      </div>
    </div>
  );
}
