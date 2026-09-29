'use client';

// Профиль по прототипу: карточка (фото, имя, роль · город, теги), «Вход и контакты», «Организация» / «Свой инвентарь»,
// «История смен», «Пометки площадки», «Отзывы», «Договор». Справа — сводка.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ACCESS, GEAR, JOB_TYPES, OBJECT_KINDS, ORG_TYPES, TOOLS } from '@/lib/catalog';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { uploadForm } from '@/lib/image';
import { dateLabel, money, plural } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { useFlash } from '@/components/Toast';
import { useLive } from './Live';
import { Chip, Corners, FIELD_ERR, LABEL, MUTED, initialsOf } from './ui';

type Profile = {
  user: { id: string; role: 'freelancer' | 'employer'; login: string; phone: string; email: string; name: string; city: string; avatarUrl: string | null; baseLabel: string };
  profile: {
    skills?: string[]; customSkills?: string[]; gear?: string[]; customGear?: string[]; ownCar?: boolean; workCities?: string[];
    orgType?: string; orgName?: string; objectKind?: string; objectOther?: string; access?: string[]; tools?: string;
  } | null;
  stats: { done: number; rating: number | null; reviews: number; jobs: number; noShows: number };
  inn: string | null;
  history: { num: number; title: string; address: string; date: string; pay: number; unit: string; settle: string; auto: boolean }[];
  marks: { label: string; value: string }[];
  reviews: { rating: number; text: string; at: string; author: string; title: string }[];
};

const SEC_HEAD = 'font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)';
const SEC_NOTE = 'font-size: 13px; line-height: 1.45; margin-top: 6px; color: color-mix(in srgb, var(--color-text) 68%, transparent); text-wrap: pretty';
const BTN = 'height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 16px; white-space: nowrap';
const TYPE_LABEL = Object.fromEntries(JOB_TYPES.map(t => [t.id, t.label]));

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={css('display: flex; flex-wrap: wrap; gap: 10px 32px; padding: 26px 0; border-top: 1px solid var(--color-divider)')}>
      <div style={css('flex: 0 0 190px; min-width: 0')}>
        <h2 style={css(SEC_HEAD + '; margin: 0; font-weight: inherit')}>{title}</h2>
        {note && <div style={css(SEC_NOTE)}>{note}</div>}
      </div>
      <div style={css('flex: 1 1 380px; min-width: 0')}>{children}</div>
    </section>
  );
}

function errOf(e: unknown, fallback: string) {
  return e instanceof ApiError ? { field: e.field || '', message: e.message } : { field: '', message: fallback };
}

export function ProfilePage() {
  const router = useRouter();
  const flash = useFlash();
  const { setRail } = useLive();
  const [p, setP] = useState<Profile | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api<Profile>('/api/me/profile').then(r => { setP(r); setLoadErr(''); }).catch(e => setLoadErr(e instanceof ApiError ? e.message : 'Не удалось загрузить профиль'));
  }, []);
  useEffect(load, [load]);

  /** Сохранение части профиля; ответ — свежий профиль целиком. */
  const patch = async (body: Record<string, unknown>, ok?: string, key = 'patch') => {
    setBusy(key); setErr(null);
    try {
      const r = await api<Profile>('/api/me/profile', body, 'PATCH');
      setP(r);
      if (ok) flash(ok);
      router.refresh();
      return true;
    } catch (e) {
      setErr(errOf(e, 'Не удалось сохранить'));
      return false;
    } finally { setBusy(''); }
  };

  if (!p) {
    return (
      <div style={css('flex: 1; display: grid; place-items: center; padding: 40px 16px; ' + MUTED)}>
        {loadErr ? <div style={css('text-align: center')}>{loadErr}<div><button className="btn btn-secondary" onClick={load} style={css('margin-top: 12px; height: 38px')}>Повторить</button></div></div> : 'Загружаем профиль…'}
      </div>
    );
  }

  const isEmp = p.user.role === 'employer';
  const fp = p.profile || {};
  const fieldErr = (f: string) => (err && err.field === f ? <div role="alert" style={css(FIELD_ERR)}>{err.message}</div> : null);

  return (
    <div style={css('flex: 1; min-height: 0; overflow: auto; padding: 22px max(clamp(16px, 2.4vw, 40px), calc((100% - 1280px) / 2)) 48px')}>
      <div style={css('display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 22px')}>
        <button className="btn btn-ghost" onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))} style={css('height: 34px; font-size: 13.5px; padding: 0 10px 0 6px; display: inline-flex; align-items: center; gap: 6px')}>← Назад</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => setRail('settings')} style={css('height: 34px; font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; padding: 0 12px')}>Настройки</button>
        <button className="btn btn-ghost" onClick={async () => { await api('/api/auth/logout', {}).catch(() => {}); router.push('/'); router.refresh(); }}
          style={css('height: 34px; font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; padding: 0 12px')}>Выйти</button>
      </div>

      <div className="profile-grid" style={css('display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: clamp(20px, 2.4vw, 40px); align-items: start')}>
        <div style={css('min-width: 0; max-width: 880px')}>
          <HeaderCard p={p} setP={setP} patch={patch} busy={busy} err={err} />

          <div style={css('margin-top: 10px')}>
            <Contacts p={p} patch={patch} busy={busy} fieldErr={fieldErr} onPhone={load} />

            {isEmp ? <Organization p={p} patch={patch} busy={busy} fieldErr={fieldErr} /> : (
              <Section title="Свой инвентарь" note="Отмеченное видят работодатели — это поднимает отклик выше.">
                <GearEditor gear={fp.gear || []} customGear={fp.customGear || []} ownCar={!!fp.ownCar} patch={patch} fieldErr={fieldErr} />
              </Section>
            )}

            <Section title="История смен">
              {!p.history.length && <div style={css('font-size: 14px; line-height: 1.5; ' + MUTED)}>Закрытых смен пока нет. После приёмки работы смена попадёт сюда с отметкой о расчёте.</div>}
              <div style={{ display: 'grid' }}>
                {p.history.map(h => (
                  <button key={h.num} onClick={() => router.push('/?job=' + h.num)} className="row-hover"
                    style={css('display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 16px; text-align: left; cursor: pointer; background: transparent; border: 0; border-bottom: 1px solid var(--color-divider); padding: 12px 8px; margin: 0 -8px; font-family: var(--font-body); color: inherit')}>
                    <span style={css('font-family: var(--font-heading); font-size: 17px; text-transform: uppercase; letter-spacing: .02em; min-width: 0; overflow-wrap: anywhere')}>
                      <span style={css('color: var(--color-accent-700); margin-right: 8px')}>{'С-' + h.num}</span>{h.title}
                    </span>
                    <span style={css('font-family: var(--font-heading); font-size: 17px; white-space: nowrap; color: var(--color-accent-900)')}>{money(h.pay, h.unit)}</span>
                    <span style={css('grid-column: 1 / -1; font-size: 13px; ' + MUTED)}>{h.address + ' · ' + dateLabel(h.date) + ' · ' + h.settle + (h.auto ? ' · принята автоматически' : '')}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Пометки площадки" note="Поздние отказы и неявки видны 90 дней.">
              {!p.marks.length && (
                <div style={css('display: flex; gap: 10px; align-items: center; font-size: 14px')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Пометок нет
                </div>
              )}
              <div style={css('display: grid; gap: 8px')}>
                {p.marks.map((m, i) => (
                  <div key={i} style={css('border: 1px solid var(--color-accent); padding: 10px 12px')}>
                    <div style={css('font-family: var(--font-heading); font-size: 14px; text-transform: uppercase; letter-spacing: .02em; color: var(--color-accent-900)')}>{m.label}</div>
                    <div style={css('font-size: 13px; line-height: 1.4; margin-top: 2px; ' + MUTED)}>{m.value}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Отзывы" note={isEmp ? 'Что пишут исполнители после смен.' : 'Что пишут работодатели после приёмки.'}>
              {!p.reviews.length && <div style={css('font-size: 14px; line-height: 1.5; ' + MUTED)}>Отзывов пока нет — они появляются после приёмки работы.</div>}
              <div style={css('display: grid; gap: 10px')}>
                {p.reviews.map((r, i) => (
                  <div key={i} style={css('border-bottom: 1px solid var(--color-divider); padding-bottom: 10px')}>
                    <div style={css('display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap')}>
                      <span aria-label={'Оценка ' + r.rating + ' из 5'} style={css('color: var(--color-accent-700); letter-spacing: .1em')}>{'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}</span>
                      <span style={css('font-family: var(--font-heading); font-size: 14px; text-transform: uppercase; letter-spacing: .02em')}>{r.author}</span>
                      <span style={css('font-size: 12.5px; ' + MUTED)}>{r.title + ' · ' + new Date(r.at).toLocaleDateString('ru-RU')}</span>
                    </div>
                    {r.text && <div style={css('font-size: 14px; line-height: 1.45; margin-top: 4px')}>{r.text}</div>}
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Договор">
              <div style={css('display: flex; gap: 16px; align-items: center; flex-wrap: wrap')}>
                <a className="btn btn-secondary" href="/api/contract-template" download onClick={() => flash('Шаблон ГПХ скачан — заполняют стороны сами')}
                  style={css(BTN + '; display: inline-flex; align-items: center; gap: 8px; text-decoration: none')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>
                  Шаблон договора ГПХ
                </a>
                <span style={css('flex: 1 1 260px; font-size: 13px; line-height: 1.45; ' + MUTED)}>Шаблон для удобства. Платформа не оказывает юридических услуг и не проверяет договоры. В карточке смены шаблон заполняется условиями заказа.</span>
              </div>
            </Section>
          </div>

          <div style={css('border-top: 1px solid var(--color-divider); padding-top: 18px; font-size: 12.5px; line-height: 1.55; max-width: 720px; ' + MUTED)}>
            Арена Работы — платформа сезонных работ. Площадка — посредник: договор и оплату стороны оформляют между собой. Картография: тайлы <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>, данные © участники <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, ODbL.
          </div>
        </div>

        <div style={css('min-width: 0; display: grid; gap: 16px; position: sticky; top: 0')}>
          <div className="blueprint" style={css('padding: 16px')}>
            <Corners />
            <div style={css(LABEL)}>{isEmp ? 'Заказы' : 'Смены'}</div>
            <div style={css('display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px')}>
              {[
                { v: String(p.stats.done), l: isEmp ? 'принято работ' : 'смен закрыто' },
                { v: p.stats.rating == null ? '—' : p.stats.rating.toFixed(1).replace('.', ','), l: 'рейтинг' },
                { v: String(p.stats.reviews), l: plural(p.stats.reviews, 'отзыв', 'отзыва', 'отзывов') },
                isEmp ? { v: String(p.stats.jobs), l: 'заказов всего' } : { v: String(p.stats.noShows), l: 'неявок' }
              ].map(s => (
                <div key={s.l}>
                  <div style={css('font-family: var(--font-heading); font-size: 26px; line-height: 1; color: var(--color-accent-900)')}>{s.v}</div>
                  <div style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; margin-top: 5px; ' + MUTED)}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={css('border: 1px solid var(--color-divider); padding: 13px 14px; font-size: 13px; line-height: 1.5; ' + MUTED)}>
            <div style={css(LABEL + '; margin-bottom: 6px')}>Как считаются деньги</div>
            {isEmp
              ? 'Вы платите каждому исполнителю лично — наличными, переводом или по договору. Площадка не держит деньги и не берёт процент со смены.'
              : 'Работодатель платит вам лично — способ указан в заказе. Площадка не держит деньги и не берёт процент; после расчёта отметьте его в смене.'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Карточка: фото, имя, теги ─────────────────────────

function HeaderCard({ p, setP, patch, busy, err }: {
  p: Profile; setP: (p: Profile) => void; patch: (b: Record<string, unknown>, ok?: string, key?: string) => Promise<boolean>; busy: string; err: { field: string; message: string } | null;
}) {
  const router = useRouter();
  const flash = useFlash();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isEmp = p.user.role === 'employer';
  const fp = p.profile || {};

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api<{ avatarUrl: string }>('/api/me/avatar', await uploadForm(file, 640));
      setP({ ...p, user: { ...p.user, avatarUrl: r.avatarUrl } });
      flash('Фото профиля обновлено');
      router.refresh();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Не удалось загрузить фото');
    } finally { setUploading(false); }
  };
  const clearAvatar = async () => {
    try {
      await api('/api/me/avatar', null, 'DELETE');
      setP({ ...p, user: { ...p.user, avatarUrl: null } });
      router.refresh();
    } catch (e) { flash(e instanceof ApiError ? e.message : 'Не удалось убрать фото'); }
  };

  const startEdit = () => {
    const [f, ...rest] = p.user.name.split(' ');
    setFirst(f || ''); setLast(rest.join(' ')); setEditing(true);
  };
  const saveName = async () => {
    if (await patch({ firstName: first, lastName: last }, 'Имя сохранено', 'name')) setEditing(false);
  };

  // Теги: исполнитель — навыки и города (снимаются крестиком), работодатель — тип организации, объект, доступ.
  type Tag = { label: string; onRemove?: () => void };
  const tags: Tag[] = isEmp
    ? [fp.orgType, fp.objectKind === 'свой вариант' ? fp.objectOther || 'объект не указан' : fp.objectKind, fp.tools, ...(fp.access || [])]
        .filter((x): x is string => !!x).map(label => ({ label }))
    : [
        ...(fp.skills || []).map(id => ({ label: TYPE_LABEL[id] || id, onRemove: () => patch({ freelancer: { skills: (fp.skills || []).filter(x => x !== id) } }, 'Навык «' + (TYPE_LABEL[id] || id) + '» убран из профиля') })),
        ...(fp.customSkills || []).map(s => ({ label: s, onRemove: () => patch({ freelancer: { customSkills: (fp.customSkills || []).filter(x => x !== s) } }, 'Навык «' + s + '» убран из профиля') })),
        ...(fp.workCities || []).map(c => ({ label: c, onRemove: (fp.workCities || []).length > 1 ? () => patch({ freelancer: { workCities: (fp.workCities || []).filter(x => x !== c) } }) : undefined }))
      ];
  const freeSkills = JOB_TYPES.filter(t => !(fp.skills || []).includes(t.id));

  return (
    <div className="blueprint" style={css('padding: 28px')}>
      <Corners />
      <div style={css('display: flex; gap: 24px; align-items: center; flex-wrap: wrap')}>
        <div style={css('flex: none; display: grid; gap: 8px; justify-items: center')}>
          <label title="Загрузить фото" style={css('position: relative; width: 104px; height: 104px; border: 1px solid var(--color-accent); display: grid; place-items: center; cursor: pointer; overflow: hidden; background: var(--color-accent-100)')}>
            {!p.user.avatarUrl && <span style={css('font-family: var(--font-heading); font-size: 34px; letter-spacing: .02em; color: var(--color-accent-700)')}>{initialsOf(p.user.name)}</span>}
            {p.user.avatarUrl && <img src={p.user.avatarUrl} alt="Фото профиля" style={css('position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover')} />}
            {uploading && <span style={css('position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255,255,255,.7); font-size: 12px')}>загрузка…</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="Загрузить фото"
              style={css('position: absolute; inset: 0; opacity: 0; cursor: pointer')} />
          </label>
          <div style={css('display: flex; gap: 10px')}>
            <span style={css('font-family: var(--font-heading); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--color-accent-700)')}>сменить фото</span>
            {p.user.avatarUrl && <button onClick={clearAvatar} style={css('all: unset; cursor: pointer; font-family: var(--font-heading); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; ' + MUTED)}>убрать</button>}
          </div>
        </div>
        <div style={css('flex: 1 1 280px; min-width: 0')}>
          {!editing ? (
            <div style={css('display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap')}>
              <h1 style={css('margin: 0; font-size: clamp(28px, 2.6vw, 38px); line-height: 1; text-transform: uppercase; letter-spacing: .01em; overflow-wrap: anywhere')}>{p.user.name}</h1>
              <button className="btn btn-ghost" onClick={startEdit} aria-label="Изменить имя" style={css('height: 28px; font-size: 13px; padding: 0 8px')}>Изменить</button>
            </div>
          ) : (
            <div style={css('display: grid; gap: 10px')}>
              <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px')}>
                <div className="field"><label htmlFor="pf-first">Имя</label><input id="pf-first" className="input" value={first} onChange={e => setFirst(e.target.value)} placeholder="Данияр" maxLength={60} /></div>
                <div className="field"><label htmlFor="pf-last">Фамилия</label><input id="pf-last" className="input" value={last} onChange={e => setLast(e.target.value)} placeholder="Сапаров" maxLength={60} /></div>
              </div>
              {err?.field === 'name' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
              <div style={css('display: flex; gap: 8px')}>
                <button className="btn btn-primary" onClick={saveName} disabled={busy === 'name'} style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Сохранить</button>
                <button className="btn btn-ghost" onClick={() => setEditing(false)} style={css('height: 38px; font-size: 13px')}>Отменить</button>
              </div>
            </div>
          )}
          <div style={css('font-size: 14.5px; margin-top: 8px; ' + MUTED)}>{(isEmp ? 'Работодатель' : 'Исполнитель') + ' · ' + p.user.city}</div>
          <div style={css('display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; align-items: center')}>
            {tags.map(t => (
              <span key={t.label} className="tag tag-outline" style={css('display: inline-flex; align-items: center; gap: 6px')}>
                {t.label}
                {t.onRemove && <button onClick={t.onRemove} title="Убрать тег" aria-label={'Убрать «' + t.label + '»'} style={css('all: unset; cursor: pointer; line-height: 1; font-size: 14px; ' + MUTED)}>×</button>}
              </span>
            ))}
            {!isEmp && !adding && freeSkills.length > 0 && (
              <button className="tag tag-outline" onClick={() => setAdding(true)} style={css('cursor: pointer; border-style: dashed')}>+ навык</button>
            )}
            {!isEmp && adding && (
              <select className="input" autoFocus aria-label="Добавить навык" defaultValue="" onBlur={() => setAdding(false)}
                onChange={e => { const id = e.target.value; setAdding(false); if (id) patch({ freelancer: { skills: [...(fp.skills || []), id] } }, 'Навык «' + TYPE_LABEL[id] + '» добавлен'); }}
                style={css('height: 32px; min-height: 32px; font-size: 13px; padding: 0 8px; width: auto')}>
                <option value="" disabled>выберите навык</option>
                {freeSkills.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Вход и контакты ─────────────────────────

function Contacts({ p, patch, busy, fieldErr, onPhone }: {
  p: Profile; patch: (b: Record<string, unknown>, ok?: string, key?: string) => Promise<boolean>; busy: string; fieldErr: (f: string) => ReactNode; onPhone: () => void;
}) {
  const { setRail } = useLive();
  const [login, setLogin] = useState(p.user.login);
  const [email, setEmail] = useState(p.user.email);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const dirty = login.trim() !== p.user.login || email.trim() !== p.user.email;

  return (
    <Section title="Вход и контакты" note="Войти можно по логину или телефону.">
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px')}>
        <div className="field">
          <label htmlFor="pf-login">Логин</label>
          <input id="pf-login" className="input" value={login} onChange={e => setLogin(e.target.value)} placeholder="daniyar_s" autoComplete="username" maxLength={20} />
          {fieldErr('login')}
        </div>
        <div className="field">
          <label>Телефон</label>
          <div style={css('display: flex; align-items: center; min-height: 40px; gap: 10px; font-size: 14.5px; flex-wrap: wrap')}>
            {formatPhone(p.user.phone)}
            <button className="btn btn-ghost" onClick={() => setPhoneOpen(o => !o)} style={css('height: 28px; font-size: 12.5px; padding: 0 8px')}>{phoneOpen ? 'Отменить' : 'Сменить'}</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pf-email">E-mail</label>
          <input id="pf-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="для чеков и уведомлений" autoComplete="email" maxLength={200} />
          {fieldErr('email')}
        </div>
        <div className="field">
          <label>Город базы</label>
          <div style={css('display: flex; align-items: center; min-height: 40px; gap: 10px; font-size: 14.5px; flex-wrap: wrap')}>
            {p.user.baseLabel}
            <button className="btn btn-ghost" onClick={() => setRail('settings')} style={css('height: 28px; font-size: 12.5px; padding: 0 8px')}>меняется в настройках</button>
          </div>
        </div>
      </div>
      {dirty && (
        <div style={css('display: flex; gap: 8px; margin-top: 12px')}>
          <button className="btn btn-primary" disabled={busy === 'contacts'} onClick={() => patch({ login: login.trim(), email: email.trim() }, 'Контакты сохранены', 'contacts')}
            style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Сохранить</button>
          <button className="btn btn-ghost" onClick={() => { setLogin(p.user.login); setEmail(p.user.email); }} style={css('height: 38px; font-size: 13px')}>Отменить</button>
        </div>
      )}
      {phoneOpen && <PhoneChange onDone={() => { setPhoneOpen(false); onPhone(); }} />}
      <div style={css('margin-top: 14px')}>
        {!pwOpen
          ? <button className="btn btn-ghost" onClick={() => setPwOpen(true)} style={css('height: 32px; font-size: 13px; padding: 0 10px')}>Сменить пароль</button>
          : <PasswordChange onDone={() => setPwOpen(false)} />}
      </div>
    </Section>
  );
}

function PhoneChange({ onDone }: { onDone: () => void }) {
  const flash = useFlash();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ challengeId: string; sentTo: string; resendIn: number; devCode?: string } | null>(null);
  const [wait, setWait] = useState(0);
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ challengeId: string; sentTo: string; resendIn: number; devCode?: string }>('/api/me/phone/start', { phone, password });
      setSent(r); setWait(r.resendIn); setPassword('');
    } catch (e) { setErr(errOf(e, 'Не удалось отправить код')); } finally { setBusy(false); }
  };
  const resend = async () => {
    if (!sent) return;
    try {
      const r = await api<{ resendIn: number; devCode?: string }>('/api/me/phone/resend', { challengeId: sent.challengeId });
      setSent({ ...sent, devCode: r.devCode }); setWait(r.resendIn);
    } catch (e) { setErr(errOf(e, 'Не удалось отправить код')); }
  };
  const verify = async () => {
    if (!sent) return;
    setBusy(true); setErr(null);
    try {
      await api('/api/me/phone/verify', { challengeId: sent.challengeId, code });
      flash('Телефон изменён — входите по новому номеру');
      onDone();
    } catch (e) { setErr(errOf(e, 'Не удалось проверить код')); } finally { setBusy(false); }
  };

  return (
    <div style={css('margin-top: 14px; border: 1px solid var(--color-divider); padding: 14px; display: grid; gap: 10px; max-width: 520px')}>
      <div style={css(LABEL)}>Новый телефон</div>
      {!sent ? (
        <>
          <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px')}>
            <div className="field">
              <label htmlFor="ph-new">Номер</label>
              <input id="ph-new" className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 916 000 00 00" autoComplete="tel" />
              {err?.field === 'phone' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
            </div>
            <div className="field">
              <label htmlFor="ph-pass">Текущий пароль</label>
              <input id="ph-pass" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              {err?.field === 'password' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
            </div>
          </div>
          {err && !['phone', 'password'].includes(err.field) && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
          <div><button className="btn btn-primary" onClick={start} disabled={busy} style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Прислать код</button></div>
        </>
      ) : (
        <>
          <div style={css('font-size: 13.5px; line-height: 1.45')}>{'Код отправлен в SMS на ' + sent.sentTo + '.'}{sent.devCode && <span style={css(MUTED)}>{' Код для разработки: ' + sent.devCode}</span>}</div>
          <div style={css('display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap')}>
            <div className="field" style={css('width: 150px')}>
              <label htmlFor="ph-code">Код из SMS</label>
              <input id="ph-code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <button className="btn btn-primary" onClick={verify} disabled={busy || code.length < 4} style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Подтвердить</button>
            <button className="btn btn-ghost" onClick={resend} disabled={wait > 0} style={css('height: 40px; font-size: 13px')}>{wait > 0 ? 'Повторно через ' + wait + ' с' : 'Прислать ещё раз'}</button>
          </div>
          {err && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
        </>
      )}
    </div>
  );
}

function PasswordChange({ onDone }: { onDone: () => void }) {
  const flash = useFlash();
  const [f, setF] = useState({ current: '', password: '', password2: '' });
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/api/me/password', f);
      flash('Пароль изменён — на других устройствах нужно войти заново');
      onDone();
    } catch (e) { setErr(errOf(e, 'Не удалось сменить пароль')); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, label: string, ac: string) => (
    <div className="field">
      <label htmlFor={'pw-' + k}>{label}</label>
      <input id={'pw-' + k} className="input" type="password" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} autoComplete={ac} />
      {err?.field === k && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
    </div>
  );
  return (
    <div style={css('border: 1px solid var(--color-divider); padding: 14px; display: grid; gap: 10px; max-width: 620px')}>
      <div style={css(LABEL)}>Смена пароля</div>
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px')}>
        {input('current', 'Текущий пароль', 'current-password')}
        {input('password', 'Новый пароль', 'new-password')}
        {input('password2', 'Ещё раз', 'new-password')}
      </div>
      {err && !['current', 'password', 'password2'].includes(err.field) && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      <div style={css('display: flex; gap: 8px')}>
        <button className="btn btn-primary" onClick={save} disabled={busy} style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}>Сменить пароль</button>
        <button className="btn btn-ghost" onClick={onDone} style={css('height: 38px; font-size: 13px')}>Отменить</button>
      </div>
      <div style={css('font-size: 12.5px; ' + MUTED)}>После смены остальные входы (другие телефоны и браузеры) завершатся.</div>
    </div>
  );
}

// ───────────────────────── Организация / Инвентарь ─────────────────────────

function Organization({ p, patch, busy, fieldErr }: {
  p: Profile; patch: (b: Record<string, unknown>, ok?: string, key?: string) => Promise<boolean>; busy: string; fieldErr: (f: string) => ReactNode;
}) {
  const fp = p.profile || {};
  const [orgType, setOrgType] = useState(fp.orgType || '');
  const [orgName, setOrgName] = useState(fp.orgName || '');
  const [inn, setInn] = useState(p.inn || '');
  const [objectKind, setObjectKind] = useState(fp.objectKind || '');
  const [tools, setTools] = useState(fp.tools || '');
  const [access, setAccess] = useState<string[]>(fp.access || []);
  const dirty = orgType !== (fp.orgType || '') || orgName !== (fp.orgName || '') || inn !== (p.inn || '') || objectKind !== (fp.objectKind || '') ||
    tools !== (fp.tools || '') || access.join('|') !== (fp.access || []).join('|');
  const isPerson = orgType === 'частное лицо';

  return (
    <Section title="Организация" note="Тип, название и ИНН видны исполнителям в карточке заказа.">
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px')}>
        <div className="field">
          <label htmlFor="org-type">Кто размещает заказы</label>
          <select id="org-type" className="input" value={orgType} onChange={e => setOrgType(e.target.value)}>
            {ORG_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {!isPerson && (
          <div className="field">
            <label htmlFor="org-name">Название</label>
            <input id="org-name" className="input" value={orgName} onChange={e => setOrgName(e.target.value)} maxLength={160} placeholder="ТСЖ «Лесная, 12»" />
            {fieldErr('orgName')}
          </div>
        )}
        <div className="field">
          <label htmlFor="org-inn">{isPerson ? 'ИНН (необязательно)' : 'ИНН организации'}</label>
          <input id="org-inn" className="input" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="7712345678" />
          {fieldErr('inn')}
        </div>
        <div className="field">
          <label htmlFor="org-object">Обычный объект</label>
          <select id="org-object" className="input" value={objectKind} onChange={e => setObjectKind(e.target.value)}>
            <option value="">не указан</option>
            {OBJECT_KINDS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="org-tools">Инвентарь</label>
          <select id="org-tools" className="input" value={tools} onChange={e => setTools(e.target.value)}>
            <option value="">не указан</option>
            {TOOLS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div style={css('margin-top: 12px')}>
        <div style={css(LABEL + '; margin-bottom: 7px')}>Доступ на объект</div>
        <div style={css('display: flex; flex-wrap: wrap; gap: 6px')}>
          {ACCESS.map(a => <Chip key={a} active={access.includes(a)} onClick={() => setAccess(x => (x.includes(a) ? x.filter(y => y !== a) : [...x, a]))}>{a}</Chip>)}
        </div>
      </div>
      <div style={css('display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; align-items: baseline')}>
        <span className="tag tag-outline">{p.inn ? 'ИНН указан · не проверен' : 'ИНН не указан'}</span>
        <span style={css('font-size: 13px; line-height: 1.45; ' + MUTED)}>Площадка показывает ИНН как есть — исполнитель может сам проверить его в открытых реестрах ФНС.</span>
      </div>
      {dirty && (
        <div style={css('display: flex; gap: 8px; margin-top: 14px')}>
          <button className="btn btn-primary" disabled={busy === 'org'} style={css('height: 38px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase')}
            onClick={() => patch({ employer: { orgType, orgName: isPerson ? '' : orgName, inn: inn || undefined, objectKind: objectKind || undefined, tools: tools || undefined, access } }, 'Организация сохранена', 'org')}>Сохранить</button>
        </div>
      )}
    </Section>
  );
}

function GearEditor({ gear, customGear, ownCar, patch, fieldErr }: {
  gear: string[]; customGear: string[]; ownCar: boolean; patch: (b: Record<string, unknown>, ok?: string) => Promise<boolean>; fieldErr: (f: string) => ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const all = [...GEAR.filter(g => g !== 'Ничего нет'), ...customGear, 'Ничего нет'];
  const toggle = (g: string) => {
    const has = gear.includes(g);
    const next = g === 'Ничего нет' ? (has ? [] : ['Ничего нет']) : has ? gear.filter(x => x !== g) : [...gear.filter(x => x !== 'Ничего нет'), g];
    patch({ freelancer: { gear: next, customGear } });
  };
  const add = async () => {
    const v = draft.trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (all.some(g => g.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    if (await patch({ freelancer: { customGear: [...customGear, v], gear: [...gear.filter(x => x !== 'Ничего нет'), v] } }, 'Инвентарь «' + v + '» добавлен')) setDraft('');
  };
  return (
    <>
      <div style={css('display: flex; flex-wrap: wrap; gap: 6px')}>
        {all.map(g => <Chip key={g} active={gear.includes(g)} onClick={() => toggle(g)}>{g}</Chip>)}
        <Chip active={ownCar} onClick={() => patch({ freelancer: { ownCar: !ownCar } })}>своя машина</Chip>
      </div>
      <div style={css('display: flex; gap: 6px; margin-top: 12px; max-width: 520px')}>
        <input className="input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} aria-label="Свой инвентарь" maxLength={60}
          placeholder="например, мотоблок с щёткой" style={css('flex: 1; min-width: 0')} />
        <button className="btn btn-secondary" onClick={add} style={css('height: 40px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; padding: 0 14px; white-space: nowrap')}>Добавить</button>
      </div>
      {fieldErr('gear')}
    </>
  );
}
