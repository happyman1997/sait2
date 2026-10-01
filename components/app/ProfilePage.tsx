'use client';

// Профиль по прототипу: карточка (фото, имя, роль · город, теги), «Вход и контакты», «Организация» / «Свой инвентарь»,
// «История смен», «Пометки площадки», «Отзывы», «Договор». Справа — сводка.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ACCESS, GEAR, JOB_TYPES, OBJECT_KINDS, ORG_TYPES, TOOLS } from '@/lib/catalog';
import { api, ApiError } from '@/lib/api';
import { css } from '@/lib/css';
import { uploadForm } from '@/lib/image';
import { disablePush } from '@/lib/push-client';
import { dateLabel, money, plural } from '@/lib/jobs';
import { formatPhone } from '@/lib/validation';
import { useFlash } from '@/components/Toast';
import { SELF_HOSTED_MAP } from '@/components/map/style';
import { AdSlot } from './AdSlot';
import { useLive } from './Live';
import { Chip, Corners, FIELD_ERR, LABEL, MUTED, initialsOf } from './ui';
import sty from './ProfilePage.module.css';

type Profile = {
  user: { id: string; role: 'freelancer' | 'employer'; login: string; phone: string; email: string; name: string; city: string; avatarUrl: string | null; baseLabel: string; emailVerified: boolean };
  profile: {
    skills?: string[]; customSkills?: string[]; gear?: string[]; customGear?: string[]; ownCar?: boolean; workCities?: string[];
    orgType?: string; orgName?: string; objectKind?: string; objectOther?: string; access?: string[]; tools?: string;
    npd?: { inn: string | null; status: 'ok' | 'not_found' | null; checkedAt: string | null };
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
    <section className={sty.c75f6db7}>
      <div className={sty.c236af5d}>
        <h2 style={css(SEC_HEAD + '; margin: 0; font-weight: inherit')}>{title}</h2>
        {note && <div style={css(SEC_NOTE)}>{note}</div>}
      </div>
      <div className={sty.cc7e103d}>{children}</div>
    </section>
  );
}

function errOf(e: unknown, fallback: string) {
  return e instanceof ApiError ? { field: e.field || '', message: e.message } : { field: '', message: fallback };
}

export function ProfilePage() {
  const router = useRouter();
  const flash = useFlash();
  const { setRail, me } = useLive();
  const [p, setP] = useState<Profile | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api<Profile>('/api/me/profile').then(r => { setP(r); setLoadErr(''); }).catch(e => setLoadErr(e instanceof ApiError ? e.message : 'Не удалось загрузить профиль'));
  }, []);
  useEffect(load, [load]);
  // Возврат по ссылке из письма: /profile?email=ok|bad
  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get('email');
    if (!r) return;
    flash(r === 'ok' ? 'E-mail подтверждён — уведомления на почту включены' : 'Ссылка устарела или адрес уже сменили — отправьте письмо ещё раз');
    url.searchParams.delete('email');
    window.history.replaceState(null, '', url);
  }, [flash]);

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
        {loadErr ? <div className={sty.c65f9d5a}>{loadErr}<div><button className={'btn btn-secondary ' + sty.c611c8e0} onClick={load}>Повторить</button></div></div> : 'Загружаем профиль…'}
      </div>
    );
  }

  const isEmp = p.user.role === 'employer';
  const fp = p.profile || {};
  const fieldErr = (f: string) => (err && err.field === f ? <div role="alert" style={css(FIELD_ERR)}>{err.message}</div> : null);

  return (
    <div className={sty.c2120941}>
      <div className={sty.c51490d3}>
        <button className={'btn btn-ghost ' + sty.c0bba3b7} onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}>← Назад</button>
        <span style={{ flex: 1 }} />
        {me?.isStaff && <Link href="/support" className={'btn btn-ghost ' + sty.cd553319}>Поддержка</Link>}
        <button className={'btn btn-ghost ' + sty.ce42f018} onClick={() => setRail('settings')}>Настройки</button>
        <button className={'btn btn-ghost ' + sty.ce42f018} onClick={async () => {
          // Подписка на пуш принадлежит браузеру — снимаем её, чтобы уведомления не приходили следующему человеку на этом устройстве.
          await disablePush().catch(() => {});
          await api('/api/auth/logout', {}).catch(() => {}); router.push('/'); router.refresh();
        }}>Выйти</button>
      </div>

      <div className={'profile-grid ' + sty.c5f2bfed}>
        <div className={sty.c86533bd}>
          <HeaderCard p={p} setP={setP} patch={patch} busy={busy} err={err} />

          <div className={sty.ce5a6d3c}>
            <Contacts p={p} patch={patch} busy={busy} fieldErr={fieldErr} onPhone={load} />

            {isEmp ? <Organization p={p} patch={patch} busy={busy} fieldErr={fieldErr} /> : (
              <>
                <Section title="Свой инвентарь" note="Отмеченное видят работодатели — это поднимает отклик выше.">
                  <GearEditor gear={fp.gear || []} customGear={fp.customGear || []} ownCar={!!fp.ownCar} patch={patch} fieldErr={fieldErr} />
                </Section>
                <Section title="Самозанятость" note="Статус НПД проверяется по ИНН в открытом сервисе ФНС — справка не нужна.">
                  <NpdCheck npd={fp.npd} onDone={load} />
                </Section>
              </>
            )}

            <Section title="История смен">
              {!p.history.length && <div style={css('font-size: 14px; line-height: 1.5; ' + MUTED)}>Закрытых смен пока нет. После приёмки работы смена попадёт сюда с отметкой о расчёте.</div>}
              <div style={{ display: 'grid' }}>
                {p.history.map(h => (
                  <button key={h.num} onClick={() => router.push('/?job=' + h.num)} className={'row-hover ' + sty.cd9b27a8}>
                    <span className={'fh ' + sty.c1c9f7dc}>
                      <span className={sty.c8228996}>{'С-' + h.num}</span>{h.title}
                    </span>
                    <span className={'fh ' + sty.c165dda5}>{money(h.pay, h.unit)}</span>
                    <span style={css('grid-column: 1 / -1; font-size: 13px; ' + MUTED)}>{h.address + ' · ' + dateLabel(h.date) + ' · ' + h.settle + (h.auto ? ' · принята автоматически' : '')}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Пометки площадки" note="Поздние отказы и неявки видны 90 дней.">
              {!p.marks.length && (
                <div className={sty.ce3d8c26}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Пометок нет
                </div>
              )}
              <div className={sty.cd726313}>
                {p.marks.map((m, i) => (
                  <div key={i} className={sty.c2ce6819}>
                    <div className={'fh ' + sty.cc869800}>{m.label}</div>
                    <div style={css('font-size: 13px; line-height: 1.4; margin-top: 2px; ' + MUTED)}>{m.value}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Отзывы" note={isEmp ? 'Что пишут исполнители после смен.' : 'Что пишут работодатели после приёмки.'}>
              {!p.reviews.length && <div style={css('font-size: 14px; line-height: 1.5; ' + MUTED)}>Отзывов пока нет — они появляются после приёмки работы.</div>}
              <div className={sty.c5f73fd3}>
                {p.reviews.map((r, i) => (
                  <div key={i} className={sty.cb596dca}>
                    <div className={sty.ca7d1012}>
                      <span aria-label={'Оценка ' + r.rating + ' из 5'} className={sty.c7f1a80c}>{'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}</span>
                      <span className={'fh ' + sty.c583964a}>{r.author}</span>
                      <span style={css('font-size: 12.5px; ' + MUTED)}>{r.title + ' · ' + new Date(r.at).toLocaleDateString('ru-RU')}</span>
                    </div>
                    {r.text && <div className={sty.cf0e9b35}>{r.text}</div>}
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Договор">
              <div className={sty.caab70ba}>
                <a className="btn btn-secondary" href="/api/contract-template" download onClick={() => flash('Шаблон ГПХ скачан — заполняют стороны сами')}
                  style={css(BTN + '; display: inline-flex; align-items: center; gap: 8px; text-decoration: none')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>
                  Шаблон договора ГПХ
                </a>
                <span style={css('flex: 1 1 260px; font-size: 13px; line-height: 1.45; ' + MUTED)}>Шаблон для удобства. Платформа не оказывает юридических услуг и не проверяет договоры. В карточке смены шаблон заполняется условиями заказа.</span>
              </div>
            </Section>

            <Section title="Удаление аккаунта" note="Отзыв согласия на обработку персональных данных.">
              <DeleteAccount isEmp={isEmp} />
            </Section>
          </div>

          <div style={css('border-top: 1px solid var(--color-divider); padding-top: 18px; font-size: 12.5px; line-height: 1.55; max-width: 720px; ' + MUTED)}>
            Арена Работы — платформа сезонных работ. Площадка — посредник: договор и оплату стороны оформляют между собой. Картография: {SELF_HOSTED_MAP ? <>тайлы © <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a></> : <>тайлы <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a></>}, данные © участники <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, ODbL.
          </div>
        </div>

        <div className={sty.c890f362}>
          <div className={'blueprint ' + sty.cc741527}>
            <Corners />
            <div style={css(LABEL)}>{isEmp ? 'Заказы' : 'Смены'}</div>
            <div className={sty.ce186e08}>
              {[
                { v: String(p.stats.done), l: isEmp ? 'принято работ' : 'смен закрыто' },
                { v: p.stats.rating == null ? '—' : p.stats.rating.toFixed(1).replace('.', ','), l: 'рейтинг' },
                { v: String(p.stats.reviews), l: plural(p.stats.reviews, 'отзыв', 'отзыва', 'отзывов') },
                isEmp ? { v: String(p.stats.jobs), l: 'заказов всего' } : { v: String(p.stats.noShows), l: 'неявок' }
              ].map(s => (
                <div key={s.l}>
                  <div className={'fh ' + sty.c33ab335}>{s.v}</div>
                  <div style={css('font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; margin-top: 5px; ' + MUTED)}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <AdSlot place="profile" />
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
    <div className={'blueprint ' + sty.cdc6b6e9}>
      <Corners />
      <div className={sty.c0d6b929}>
        <div className={sty.c544010f}>
          <label title="Загрузить фото" className={sty.ce1ef653}>
            {!p.user.avatarUrl && <span className={'fh ' + sty.cdbd2b0b}>{initialsOf(p.user.name)}</span>}
            {p.user.avatarUrl && <img src={p.user.avatarUrl} alt="Фото профиля" className={sty.c6412d40} />}
            {uploading && <span className={sty.c265f060}>загрузка…</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="Загрузить фото"
              className={sty.cfa58977} />
          </label>
          <div className={sty.cd1956dd}>
            <span className={'fh ' + sty.cb9e4c90}>сменить фото</span>
            {p.user.avatarUrl && <button onClick={clearAvatar} style={css('all: unset; cursor: pointer; font-family: var(--font-heading); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; ' + MUTED)}>убрать</button>}
          </div>
        </div>
        <div className={sty.ceb4f2b0}>
          {!editing ? (
            <div className={sty.c2de84e8}>
              <h1 className={sty.c4d09782}>{p.user.name}</h1>
              <button className={'btn btn-ghost ' + sty.ce0c9da2} onClick={startEdit} aria-label="Изменить имя">Изменить</button>
            </div>
          ) : (
            <div className={sty.c5f73fd3}>
              <div className={sty.cf4e7254}>
                <div className="field"><label htmlFor="pf-first">Имя</label><input id="pf-first" className="input" value={first} onChange={e => setFirst(e.target.value)} placeholder="Данияр" maxLength={60} /></div>
                <div className="field"><label htmlFor="pf-last">Фамилия</label><input id="pf-last" className="input" value={last} onChange={e => setLast(e.target.value)} placeholder="Сапаров" maxLength={60} /></div>
              </div>
              {err?.field === 'name' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
              <div className={sty.cb9b7b53}>
                <button className={'btn btn-primary ' + sty.cf8f6389} onClick={saveName} disabled={busy === 'name'}>Сохранить</button>
                <button className={'btn btn-ghost ' + sty.c1d41128} onClick={() => setEditing(false)}>Отменить</button>
              </div>
            </div>
          )}
          <div style={css('font-size: 14.5px; margin-top: 8px; ' + MUTED)}>{(isEmp ? 'Работодатель' : 'Исполнитель') + ' · ' + p.user.city}</div>
          <div className={sty.c81a29e9}>
            {tags.map(t => (
              <span key={t.label} className={'tag tag-outline ' + sty.c687e3e0}>
                {t.label}
                {t.onRemove && <button onClick={t.onRemove} title="Убрать тег" aria-label={'Убрать «' + t.label + '»'} style={css('all: unset; cursor: pointer; line-height: 1; font-size: 14px; ' + MUTED)}>×</button>}
              </span>
            ))}
            {!isEmp && !adding && freeSkills.length > 0 && (
              <button className={'tag tag-outline ' + sty.c86fd59c} onClick={() => setAdding(true)}>+ навык</button>
            )}
            {!isEmp && adding && (
              <select className={'input ' + sty.c772d10c} autoFocus aria-label="Добавить навык" defaultValue="" onBlur={() => setAdding(false)}
                onChange={e => { const id = e.target.value; setAdding(false); if (id) patch({ freelancer: { skills: [...(fp.skills || []), id] } }, 'Навык «' + TYPE_LABEL[id] + '» добавлен'); }}>
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
      <div className={sty.ca630824}>
        <div className="field">
          <label htmlFor="pf-login">Логин</label>
          <input id="pf-login" className="input" value={login} onChange={e => setLogin(e.target.value)} placeholder="daniyar_s" autoComplete="username" maxLength={20} />
          {fieldErr('login')}
        </div>
        <div className="field">
          <label>Телефон</label>
          <div className={sty.c1120df7}>
            {formatPhone(p.user.phone)}
            <button className={'btn btn-ghost ' + sty.c28cbbc4} onClick={() => setPhoneOpen(o => !o)}>{phoneOpen ? 'Отменить' : 'Сменить'}</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pf-email">E-mail</label>
          <input id="pf-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="для чеков и уведомлений" autoComplete="email" maxLength={200} />
          {fieldErr('email')}
          {email.trim() === p.user.email && <EmailStatus verified={p.user.emailVerified} />}
        </div>
        <div className="field">
          <label>Город базы</label>
          <div className={sty.c1120df7}>
            {p.user.baseLabel}
            <button className={'btn btn-ghost ' + sty.c28cbbc4} onClick={() => setRail('settings')}>меняется в настройках</button>
          </div>
        </div>
      </div>
      {dirty && (
        <div className={sty.c5c223c4}>
          <button className={'btn btn-primary ' + sty.cf8f6389} disabled={busy === 'contacts'} onClick={() => patch({ login: login.trim(), email: email.trim() }, 'Контакты сохранены', 'contacts')}>Сохранить</button>
          <button className={'btn btn-ghost ' + sty.c1d41128} onClick={() => { setLogin(p.user.login); setEmail(p.user.email); }}>Отменить</button>
        </div>
      )}
      {phoneOpen && <PhoneChange onDone={() => { setPhoneOpen(false); onPhone(); }} />}
      <div className={sty.cdffc4db}>
        {!pwOpen
          ? <button className={'btn btn-ghost ' + sty.c1aa09b8} onClick={() => setPwOpen(true)}>Сменить пароль</button>
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
    <div className={sty.ce97d98d}>
      <div style={css(LABEL)}>Новый телефон</div>
      {!sent ? (
        <>
          <div className={sty.c846dd40}>
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
          <div><button className={'btn btn-primary ' + sty.cf8f6389} onClick={start} disabled={busy}>Прислать код</button></div>
        </>
      ) : (
        <>
          <div className={sty.c30c0749}>{'Код отправлен в SMS на ' + sent.sentTo + '.'}{sent.devCode && <span style={css(MUTED)}>{' Код для разработки: ' + sent.devCode}</span>}</div>
          <div className={sty.ca80eb44}>
            <div className={'field ' + sty.c0a9e77d}>
              <label htmlFor="ph-code">Код из SMS</label>
              <input id="ph-code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <button className={'btn btn-primary ' + sty.cad84e51} onClick={verify} disabled={busy || code.length < 4}>Подтвердить</button>
            <button className={'btn btn-ghost ' + sty.c8dc805f} onClick={resend} disabled={wait > 0}>{wait > 0 ? 'Повторно через ' + wait + ' с' : 'Прислать ещё раз'}</button>
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
    <div className={sty.cedec8fc}>
      <div style={css(LABEL)}>Смена пароля</div>
      <div className={sty.c56b5181}>
        {input('current', 'Текущий пароль', 'current-password')}
        {input('password', 'Новый пароль', 'new-password')}
        {input('password2', 'Ещё раз', 'new-password')}
      </div>
      {err && !['current', 'password', 'password2'].includes(err.field) && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      <div className={sty.cb9b7b53}>
        <button className={'btn btn-primary ' + sty.cf8f6389} onClick={save} disabled={busy}>Сменить пароль</button>
        <button className={'btn btn-ghost ' + sty.c1d41128} onClick={onDone}>Отменить</button>
      </div>
      <div style={css('font-size: 12.5px; ' + MUTED)}>После смены остальные входы (другие телефоны и браузеры) завершатся.</div>
    </div>
  );
}

/** Удаление аккаунта: что стирается и что остаётся у второй стороны, пароль и слово-подтверждение. */
function DeleteAccount({ isEmp }: { isEmp: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!window.confirm('Удалить аккаунт без возможности восстановления?')) return;
    setBusy(true); setErr(null);
    try {
      await api('/api/me/delete', f);
      window.location.href = '/';
    } catch (e) { setErr(errOf(e, 'Не удалось удалить аккаунт')); } finally { setBusy(false); }
  };
  const note = 'font-size: 13px; line-height: 1.5; ' + MUTED;
  if (!open) {
    return (
      <div style={css('display: flex; gap: 12px; align-items: center; flex-wrap: wrap')}>
        <button className="btn btn-ghost" onClick={() => setOpen(true)} style={css(BTN)}>Удалить аккаунт…</button>
        <span style={css('flex: 1 1 260px; ' + note)}>Стираются имя, телефон, почта, пароль, фото профиля и {isEmp ? 'данные организации, объекты' : 'навыки, ИНН'}; войти больше нельзя.</span>
      </div>
    );
  }
  return (
    <div style={css('display: grid; gap: 10px; max-width: 560px')}>
      <div style={css(note)}>
        Сразу стираются: имя, телефон, почта, пароль, город и база, фото профиля, {isEmp ? 'организация и ИНН, объекты' : 'навыки, инвентарь, ИНН'}, журнал уведомлений, подписки.
        {isEmp ? ' Открытые заказы без нанятых снимаются.' : ' Ждущие отклики отзываются.'}{' '}
        Остаются у второй стороны — без вашего имени, как «Удалённый пользователь»: заказы и смены, переписка, отзывы, споры, фото смен.
        Пока идёт смена, не принята работа или открыт спор, удалить аккаунт нельзя.
      </div>
      <div className="field">
        <label htmlFor="del-pass">Пароль</label>
        <input id="del-pass" className="input" type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
        {err?.field === 'password' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      </div>
      <div className="field">
        <label htmlFor="del-confirm">Впишите слово УДАЛИТЬ</label>
        <input id="del-confirm" className="input" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} />
        {err?.field === 'confirm' && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      </div>
      {err && !['password', 'confirm'].includes(err.field) && <div role="alert" style={css(FIELD_ERR)}>{err.message}</div>}
      <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
        <button className="btn btn-primary" onClick={remove} disabled={busy || !f.password || !f.confirm} style={css(BTN)}>Удалить аккаунт</button>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); setErr(null); }} style={css(BTN)}>Отменить</button>
      </div>
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
      <div className={sty.c671477c}>
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
      <div className={sty.c4bb9003}>
        <div style={css(LABEL + '; margin-bottom: 7px')}>Доступ на объект</div>
        <div className={sty.c2bf69bb}>
          {ACCESS.map(a => <Chip key={a} active={access.includes(a)} onClick={() => setAccess(x => (x.includes(a) ? x.filter(y => y !== a) : [...x, a]))}>{a}</Chip>)}
        </div>
      </div>
      <div className={sty.c71dea44}>
        <span className="tag tag-outline">{p.inn ? 'ИНН указан · не проверен' : 'ИНН не указан'}</span>
        <span style={css('font-size: 13px; line-height: 1.45; ' + MUTED)}>Площадка показывает ИНН как есть — исполнитель может сам проверить его в открытых реестрах ФНС.</span>
      </div>
      {dirty && (
        <div className={sty.cc3502a9}>
          <button className={'btn btn-primary ' + sty.cf8f6389} disabled={busy === 'org'}
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
      <div className={sty.c2bf69bb}>
        {all.map(g => <Chip key={g} active={gear.includes(g)} onClick={() => toggle(g)}>{g}</Chip>)}
        <Chip active={ownCar} onClick={() => patch({ freelancer: { ownCar: !ownCar } })}>своя машина</Chip>
      </div>
      <div className={sty.cf4bfb50}>
        <input className={'input ' + sty.c8b4ab7f} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} aria-label="Свой инвентарь" maxLength={60}
          placeholder="например, мотоблок с щёткой" />
        <button className={'btn btn-secondary ' + sty.c27fa87c} onClick={add}>Добавить</button>
      </div>
      {fieldErr('gear')}
    </>
  );
}

// ───────────────────────── E-mail и самозанятость ─────────────────────────

function EmailStatus({ verified }: { verified: boolean }) {
  const flash = useFlash();
  const [sent, setSent] = useState(false);
  if (verified) return <div className={sty.c28d9942}>✓ подтверждён</div>;
  return (
    <div style={css('font-size: 12.5px; line-height: 1.4; margin-top: 5px; ' + MUTED)}>
      {sent ? 'Письмо отправлено — перейдите по ссылке из него. ' : 'Не подтверждён — письма об уведомлениях не приходят. '}
      <button className={'btn btn-ghost ' + sty.ccb1964b} onClick={async () => {
        try { await api('/api/me/email/verify', {}); setSent(true); flash('Письмо со ссылкой отправлено'); }
        catch (e) { flash(e instanceof ApiError ? e.message : 'Не удалось отправить письмо'); }
      }}>{sent ? 'Отправить ещё раз' : 'Отправить письмо'}</button>
    </div>
  );
}

function NpdCheck({ npd, onDone }: { npd?: { inn: string | null; status: 'ok' | 'not_found' | null; checkedAt: string | null }; onDone: () => void }) {
  const flash = useFlash();
  const [inn, setInn] = useState(npd?.inn || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ status: 'ok' | 'not_found' }>('/api/me/npd', { inn });
      flash(r.status === 'ok' ? 'ФНС подтвердила статус самозанятого' : 'ФНС не нашла статус по этому ИНН');
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Проверка не прошла — попробуйте позже'); } finally { setBusy(false); }
  };
  const when = npd?.checkedAt ? new Date(npd.checkedAt).toLocaleDateString('ru-RU') : '';
  return (
    <>
      <div className={sty.c4da9731}>
        <div className={'field ' + sty.c38fb825}>
          <label htmlFor="npd-inn">ИНН самозанятого</label>
          <input id="npd-inn" className="input" inputMode="numeric" value={inn} onChange={e => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="770712345678" />
        </div>
        <button className="btn btn-secondary" onClick={check} disabled={busy || inn.length !== 12} style={css(BTN)}>{busy ? 'Запрос в ФНС…' : 'Проверить'}</button>
      </div>
      {err && <div role="alert" style={css(FIELD_ERR)}>{err}</div>}
      <div className={sty.cc452ac4}>
        <span className={'tag ' + (npd?.status === 'ok' ? 'tag-accent' : 'tag-outline')}>
          {npd?.status === 'ok' ? 'Самозанятый · проверено ' + when : npd?.status === 'not_found' ? 'Статус не найден · ' + when : 'Статус не проверен'}
        </span>
        <span style={css('font-size: 13px; line-height: 1.45; ' + MUTED)}>
          {npd?.status === 'ok'
            ? 'Работодатели видят бейдж в откликах. ФНС перепроверяет статус раз в сутки. Чеки НПД выставляете сами в «Мой налог».'
            : 'Бейдж доверия в откликах. Встать на учёт можно в приложении «Мой налог»; платформа в расчётах не участвует.'}
        </span>
      </div>
    </>
  );
}
