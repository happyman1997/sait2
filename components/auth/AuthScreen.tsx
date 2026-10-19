'use client';

// Экран «Вход / регистрация / восстановление» — по прототипу (design/… v5.dc.html, stage === 'auth').
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import { ACCESS, GEAR, GEAR_FOR, JOB_TYPES, NO_GEAR, OBJECT_KINDS, ORG_TYPES, PASS_MODES, SAFETY_REQ, TOOLS } from '@/lib/catalog';
import { css } from '@/lib/css';
import { plural } from '@/lib/jobs';
import { passwordProblem } from '@/lib/password-policy';
import { contactsMessage, contactsMissing, EMAIL_RE, LOGIN_RE, validateProfile, type Role } from '@/lib/validation';
import { showModeration } from '@/components/ModerationGuard';
import { DocLinks } from '@/components/DocLinks';
import { useFlash } from '@/components/Toast';
import { useNarrow } from '@/components/useNarrow';
import { CityInput } from '@/components/CityInput';
import { PasswordInput } from '@/components/PasswordInput';
import sty from './AuthScreen.module.css';

export type AuthMode = 'signup' | 'login' | 'recover';
type Stats = { freelancers: number; employers: number; day: string };
type CodeSent = { challengeId: string; sentTo: string; resendIn: number; devCode?: string };
const CODE_LEN = 6;

const LABEL = 'font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)';
const REQ = 'font-family: var(--font-heading); font-size: 11.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--color-accent-700)';
const H3 = 'margin: 0 0 14px; font-size: 24px; text-transform: uppercase; letter-spacing: .02em';
const HINT = 'font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--color-text) 62%, transparent)';
const NOTE = 'font-size: 13px; line-height: 1.4; margin-top: 7px; color: color-mix(in srgb, var(--color-text) 64%, transparent)';
const ALERT = 'font-size: 13.5px; font-weight: 600; line-height: 1.4; margin-top: 16px; color: var(--color-accent-900); border: 2px solid var(--color-accent-700); padding: 9px 11px; background: var(--color-accent-100)';
const DRAFT_INPUT = 'flex: 1; min-width: 0; height: 40px; font-size: 14px; border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 8%, transparent); color: var(--color-accent-900); --placeholder-color: var(--color-accent-700)';
const PRIMARY = 'height: 46px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase';
const LINK_BTN = 'margin-top: 14px; padding: 0; border: 0; background: transparent; cursor: pointer; font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--color-accent-700)';
const UNDERLINE_BTN = 'padding: 0; border: 0; background: transparent; cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--color-accent-700); text-decoration: underline';

function segStyle(active: boolean) {
  return css('flex: 1; min-width: 0; cursor: pointer; border: 0; transition: background .15s; background: ' +
    (active ? 'var(--color-neutral-100)' : 'transparent') + '; box-shadow: ' + (active ? '0 1px 4px rgba(31,45,58,.14)' : 'none') +
    '; color: ' + (active ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 70%, transparent)') +
    '; font-family: var(--font-heading); font-size: 14.5px; letter-spacing: .03em; padding: 10px 8px');
}

function roleCardStyle(active: boolean) {
  return css('min-width: 0; box-sizing: border-box; cursor: pointer; text-align: left; padding: 14px; background: ' +
    (active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent') + '; border: 1px solid ' +
    (active ? 'var(--color-accent)' : 'var(--color-divider)') + '; color: ' + (active ? 'var(--color-accent-900)' : 'var(--color-text)') + '; font-family: var(--font-body)');
}

const Corners = () => <><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={('tag ' + (active ? 'tag-accent' : 'tag-outline')) + ' ' + sty.c4008c14} onClick={onClick}
      aria-pressed={active}>{children}</button>
  );
}

const fmtNum = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** С какого числа показывать счётчики людей на площадке. */
const STATS_MIN = 50;

type OAuthProvider = 'yandex' | 'vk';
const OAUTH_LABEL: Record<OAuthProvider, string> = { yandex: 'Войти через Яндекс ID', vk: 'Войти через VK ID' };

/** «Войти через Яндекс ID / VK ID» — переход к сервису; вернёт в аккаунт или в анкету с готовыми данными. */
function OAuthButtons({ providers, apply, lead }: { providers: OAuthProvider[]; apply?: number; lead: string }) {
  if (!providers.length) return null;
  return (
    <div style={css('margin: 4px 0 18px')}>
      <div style={css(HINT + '; margin-bottom: 8px')}>{lead}</div>
      <div style={css('display: grid; gap: 8px')}>
        {providers.map(p => (
          <a key={p} href={'/api/auth/oauth/' + p + '/start' + (apply ? '?apply=' + apply : '')} className="btn btn-secondary btn-block"
            style={css('height: 44px; display: grid; place-items: center; font-size: 14px; text-decoration: none')}>{OAUTH_LABEL[p]}</a>
        ))}
      </div>
      <div style={css(HINT + '; margin-top: 12px; text-align: center')}>или по почте</div>
    </div>
  );
}

type OAuthTicketInfo = { provider: OAuthProvider; providerName: string; name: string; email: string };

export function AuthScreen({ initialMode, initialRole, stats, pending, oauthProviders = [], oauthTicket, oauthError }: {
  initialMode: AuthMode; initialRole: Role; stats: Stats; pending?: { num: number; title: string } | null;
  oauthProviders?: OAuthProvider[]; oauthTicket?: string | null; oauthError?: string | null;
}) {
  const router = useRouter();
  const flash = useFlash();
  const narrow = useNarrow();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role>(initialRole);
  const [busy, setBusy] = useState(false);

  // Контакты
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');

  // Профиль исполнителя
  const [skills, setSkills] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState('');
  const [gear, setGear] = useState<string[]>([]);
  const [customGear, setCustomGear] = useState<string[]>([]);
  const [gearDraft, setGearDraft] = useState('');
  const [workCities, setWorkCities] = useState<string[]>([]);
  const [cityDraft, setCityDraft] = useState('');
  const [loginCyr, setLoginCyr] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [ownCar, setOwnCar] = useState(false);

  // Профиль работодателя
  const [orgType, setOrgType] = useState('частное лицо');
  const [orgName, setOrgName] = useState('');
  const [objectKind, setObjectKind] = useState('частный двор');
  const [objectOther, setObjectOther] = useState('');
  const [access, setAccess] = useState<string[]>([]);
  const [tools, setTools] = useState('');
  const [meetName, setMeetName] = useState('');
  const [meetPhone, setMeetPhone] = useState('');
  const [passMode, setPassMode] = useState('');
  const [passWhom, setPassWhom] = useState('');
  const [safetyReq, setSafetyReq] = useState<string[]>([]);

  // Код
  const [challenge, setChallenge] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(3);
  const [resendIn, setResendIn] = useState(0);
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [pdConsent, setPdConsent] = useState(false);
  const [offerError, setOfferError] = useState('');

  // Вход и восстановление
  const [identifier, setIdentifier] = useState('');
  const [recoverStep, setRecoverStep] = useState(1);
  const [recoverCode, setRecoverCode] = useState('');
  const [recoverPass, setRecoverPass] = useState('');
  const [recoverPass2, setRecoverPass2] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);

  // Регистрация после «Войти через…»: билет и почта, которую сервис уже подтвердил (с ней код не нужен).
  const [oauth, setOauth] = useState<{ ticket: string; providerName: string; email: string } | null>(null);
  const skipCode = !!oauth?.email && oauth.email.toLowerCase() === email.trim().toLowerCase();

  // Ошибки
  const [stepError, setStepError] = useState(oauthError || '');
  const [errTick, setErrTick] = useState(0);
  const [missFields, setMissFields] = useState<string[]>([]);
  const missTimer = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  const isEmp = role === 'employer';
  const stepErrAnim = (errTick % 2 ? 'errBlinkA' : 'errBlinkB') + ' .7s ease-in-out 1';

  // Таймер «Отправить снова через 0:59».
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Новый шаг — с начала: иначе на телефоне он открывается там, куда долистали предыдущий (у кнопки «Далее»).
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [step, mode]);

  // Режим в адресной строке — чтобы «Назад» в браузере и ссылки работали.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('mode') !== mode) {
      url.searchParams.set('mode', mode);
      window.history.replaceState(null, '', url);
    }
  }, [mode]);

  // После входа доводим до конца действие, которое его потребовало: отложенный отклик.
  const done = (role?: Role) => {
    router.replace(pending ? '/?job=' + pending.num + (role !== 'employer' ? '&apply=1' : '') : '/');
    router.refresh();
  };

  const showError = useCallback((msg: string) => { setStepError(msg); setErrTick(t => t + 1); }, []);

  // Возврат от Яндекс ID / VK ID: ошибка — показать; билет — заполнить анкету данными сервиса и убрать его из адреса.
  useEffect(() => {
    const url = new URL(window.location.href);
    // Текст ошибки уже в stepError (начальное значение) — здесь только чистим адрес.
    url.searchParams.delete('oauth_error');
    url.searchParams.delete('oauth');
    window.history.replaceState(null, '', url);
    if (!oauthTicket) return;
    api<OAuthTicketInfo>('/api/auth/oauth/ticket?t=' + encodeURIComponent(oauthTicket))
      .then(t => {
        setOauth({ ticket: oauthTicket, providerName: t.providerName, email: t.email });
        if (t.name) setName(t.name);
        if (t.email) setEmail(t.email);
        setMode('signup');
        setStep(1);
      })
      .catch(e => showError(e instanceof ApiError ? e.message : 'Вход через сервис не удался — попробуйте ещё раз.'));
  }, [oauthTicket, showError]);

  const flashFields = useCallback((fields: string[], message: string) => {
    clearTimeout(missTimer.current);
    setStepError(message);
    setMissFields(fields);
    setErrTick(t => t + 1);
    missTimer.current = window.setTimeout(() => setMissFields([]), 1400);
  }, []);

  const missStyle = (key: string, required: boolean) => {
    const on = missFields.includes(key);
    const base = required ? 'border-left-width: 3px; border-left-style: solid; border-left-color: var(--color-accent); ' : '';
    if (!on) return base;
    return base + 'border-top-color: var(--color-accent); border-right-color: var(--color-accent); border-bottom-color: var(--color-accent); border-left-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 16%, transparent); animation: missPulse .45s ease-in-out 2';
  };

  /** Ошибка сервера → подсветка поля / попап модерации / текст. */
  const handleApiError = (e: unknown, fieldMap: Record<string, string> = {}) => {
    if (e instanceof ApiError) {
      const b = e.body;
      if (b.moderation) {
        showModeration(b.moderation.label, b.moderation.category);
        flashFields([fieldMap[b.field || ''] || b.field || ''], b.message);
        return;
      }
      if (b.field) { flashFields([fieldMap[b.field] || b.field], b.message); return; }
      showError(b.message);
      return;
    }
    showError('Что-то пошло не так — попробуйте ещё раз.');
  };

  const switchMode = (m: AuthMode) => {
    setMode(m);
    setStepError('');
    setRecoverSent(false);
    if (m === 'recover') { setRecoverStep(1); setRecoverCode(''); setRecoverPass(''); setRecoverPass2(''); }
    if (m === 'login') setRecoverStep(1);
  };

  type Drafted = { customSkills: string[]; customGear: string[]; gear: string[]; workCities: string[] };
  const signupPayload = (drafted?: Drafted) => ({
    role, name, login, password: oauth ? '' : pass, email, city, oauthTicket: oauth?.ticket,
    freelancer: role === 'freelancer' ? { skills, customSkills, gear, customGear, ownCar, workCities, ...drafted } : undefined,
    employer: role === 'employer' ? { orgType, orgName, objectKind, objectOther, access, tools, meetName, meetPhone, passMode, passWhom, safetyReq } : undefined
  });

  const startCodeTimer = (c: CodeSent) => {
    setChallenge(c);
    setCode('');
    setCodeError('');
    setAttemptsLeft(3);
    setResendIn(c.resendIn);
  };

  // ─── Регистрация ───

  const nextStep = async () => {
    if (busy) return;
    if (step === 1) { setStep(2); setStepError(''); return; }
    if (step === 2) {
      const miss = contactsMissing({ name, login, password: pass, email, city }, { requirePassword: !oauth });
      if (miss.length) {
        flashFields(miss.map(m => (m === 'password' ? 'pass' : m)), contactsMessage(miss[0], email, { login, email, password: pass }));
        return;
      }
      setBusy(true);
      try {
        await api('/api/auth/signup/check', signupPayload());
        setStep(3);
        setStepError('');
        if (!workCities.length) setWorkCities([city.trim()]);
      } catch (e) {
        handleApiError(e, { password: 'pass' });
      } finally { setBusy(false); }
      return;
    }
    if (step === 3) {
      const drafted = role === 'freelancer' ? flushDrafts() : undefined;
      const err = validateProfile(role, { freelancer: { skills, customSkills: drafted?.customSkills, workCities: drafted?.workCities }, employer: { access, tools } });
      if (err) { flashFields([err.field], err.message); return; }
      // Почту уже подтвердил сервис — без кода, сразу к согласию.
      if (skipCode) { setStep(4); setStepError(''); return; }
      setBusy(true);
      try {
        const c = await api<CodeSent>('/api/auth/signup/start', signupPayload(drafted));
        startCodeTimer(c);
        setStep(4);
        setStepError('');
      } catch (e) {
        if (e instanceof ApiError && ['name', 'login', 'email', 'city', 'password'].includes(e.field || '') && !e.body.moderation) setStep(2);
        handleApiError(e, { password: 'pass' });
      } finally { setBusy(false); }
      return;
    }
    // Шаг 4: оферта + код
    if (!offerAccepted || !pdConsent) {
      setOfferError(!offerAccepted ? 'Без принятия оферты аккаунт создать нельзя — отметьте галочку.' : 'Без согласия на обработку персональных данных аккаунт создать нельзя — отметьте галочку.');
      setErrTick(t => t + 1);
      return;
    }
    if (skipCode) {
      setBusy(true);
      try {
        await api('/api/auth/oauth/signup', { ...signupPayload(), offerAccepted, pdConsent });
        flash('Аккаунт создан');
        done(role);
      } catch (e) {
        if (e instanceof ApiError && e.status === 410) { setOauth(null); setStep(1); showError(e.message); }
        else if (e instanceof ApiError && ['name', 'login', 'email', 'city'].includes(e.field || '') && !e.body.moderation) { setStep(2); handleApiError(e); }
        else handleApiError(e);
      } finally { setBusy(false); }
      return;
    }
    if (attemptsLeft <= 0) { setCodeError('Попытки исчерпаны — запросите новый код'); return; }
    if (code.length < CODE_LEN) { setCodeError('Введите все шесть цифр из письма'); return; }
    setBusy(true);
    try {
      await api('/api/auth/signup/verify', { challengeId: challenge?.challengeId, code, offerAccepted, pdConsent });
      flash('Аккаунт создан');
      done(role);
    } catch (e) {
      if (e instanceof ApiError && e.field === 'code') {
        setCode('');
        setCodeError(e.message);
        if (typeof e.body.attemptsLeft === 'number') setAttemptsLeft(e.body.attemptsLeft);
      } else if (e instanceof ApiError && (e.field === 'email' || e.field === 'login')) {
        setStep(2);
        handleApiError(e);
      } else if (e instanceof ApiError && e.status === 410) {
        setStep(3);
        showError(e.message);
      } else handleApiError(e);
    } finally { setBusy(false); }
  };

  const resend = async () => {
    if (!challenge || busy) return;
    setBusy(true);
    try {
      const c = await api<CodeSent>('/api/auth/signup/resend', { challengeId: challenge.challengeId });
      startCodeTimer(c);
      flash('Новый код отправлен на почту');
    } catch (e) {
      if (e instanceof ApiError) setCodeError(e.message); else setCodeError('Не получилось отправить код — попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  const typeCode = (k: string) => {
    if (attemptsLeft <= 0) return;
    setCode(c => (k === '←' ? c.slice(0, -1) : c.length < CODE_LEN ? c + k : c));
    setCodeError('');
  };

  const addCustom = (kind: 'skill' | 'gear') => {
    const v = (kind === 'skill' ? skillDraft : gearDraft).trim();
    if (!v) return;
    if (kind === 'skill') {
      setCustomSkills(cur => (cur.includes(v) ? cur : cur.concat([v]).slice(0, 8)));
      setSkillDraft('');
    } else {
      setCustomGear(cur => (cur.includes(v) ? cur : cur.concat([v]).slice(0, 8)));
      setGear(g => (g.includes(v) ? g : g.filter(x => x !== NO_GEAR).concat([v])));
      setGearDraft('');
    }
    flash((kind === 'skill' ? 'Навык' : 'Инвентарь') + ' «' + v + '» добавлен в профиль');
  };

  /** picked — город, выбранный в подсказках (черновик в этот момент ещё не обновился). */
  const addCity = (picked?: string) => {
    const v = (picked ?? cityDraft).trim();
    if (!v) return;
    if (workCities.some(c => c.toLowerCase() === v.toLowerCase())) { setCityDraft(''); return; }
    setWorkCities(c => c.concat([v]));
    setCityDraft('');
    setStepError('');
  };

  /** Вписанное в поля «свой навык», «свой инвентарь», «город», но не добавленное кнопкой, — не теряем: добавляем при «Далее». */
  const flushDrafts = (): Drafted => {
    const add = (list: string[], v: string, max: number) => (v && !list.some(x => x.toLowerCase() === v.toLowerCase()) ? list.concat([v]).slice(0, max) : list);
    const sk = skillDraft.trim(), gr = gearDraft.trim(), ct = cityDraft.trim();
    const out = { customSkills: add(customSkills, sk, 8), customGear: add(customGear, gr, 8), gear: gr && !gear.includes(gr) ? gear.filter(x => x !== NO_GEAR).concat([gr]) : gear, workCities: add(workCities, ct, 20) };
    if (sk || gr || ct) {
      setCustomSkills(out.customSkills); setCustomGear(out.customGear); setGear(out.gear); setWorkCities(out.workCities);
      setSkillDraft(''); setGearDraft(''); setCityDraft('');
    }
    return out;
  };

  const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fn(); }
  };

  // «Ничего нет» снимает отмеченный инвентарь, отмеченный инвентарь — «Ничего нет» (как в профиле).
  const pickGear = (g: string) => {
    if (g === NO_GEAR && !gear.includes(NO_GEAR)) { setGear([NO_GEAR]); setCustomGear([]); return; }
    setGear(cur => (cur.includes(g) ? cur.filter(x => x !== g) : [...cur.filter(x => x !== NO_GEAR), g]));
  };
  // Сначала — то, что пригодится для отмеченных работ; «Ничего нет» — последним.
  const gearFirst = [...new Set(skills.flatMap(s => GEAR_FOR[s] || []))];
  const gearOrder = [...gearFirst, ...GEAR.filter(g => g !== NO_GEAR && !gearFirst.includes(g)), NO_GEAR];
  const showGear = gearOpen || gear.length > 0 || customGear.length > 0 || !!gearDraft;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter(x => x !== v) : list.concat([v]));

  // ─── Вход ───

  const doLogin = async () => {
    if (busy) return;
    const contact = identifier.trim();
    if (!contact) { showError('Введите почту или логин.'); return; }
    if (contact.includes('@') ? !EMAIL_RE.test(contact) : !LOGIN_RE.test(contact)) {
      showError(contact.includes('@') ? 'Проверьте почту — похоже, в адресе опечатка.' : 'Логин — 3–20 символов: латиница, цифры, точка или подчёркивание.');
      return;
    }
    if (pass.length < 6) { showError('Пароль — не короче 6 символов.'); return; }
    setBusy(true);
    try {
      const r = await api<{ user: { role: Role } }>('/api/auth/login', { identifier: contact, password: pass });
      setStepError('');
      if (pending && r.user.role === 'employer') flash('Откликаться может только исполнитель');
      done(r.user.role);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Что-то пошло не так — попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  // ─── Восстановление ───

  const recoverSend = async () => {
    const v = identifier.trim();
    if (!v) { setRecoverSent(false); showError('Укажите почту или логин аккаунта — код придёт на почту аккаунта.'); return; }
    setBusy(true);
    try {
      const c = challenge && recoverStep === 2
        ? await api<CodeSent>('/api/auth/recover/resend', { challengeId: challenge.challengeId })
        : await api<CodeSent>('/api/auth/recover/start', { identifier: v });
      setChallenge(c);
      setStepError('');
      setRecoverSent(true);
      setRecoverStep(2);
      setRecoverCode('');
      flash('Код восстановления отправлен на почту аккаунта');
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Не получилось отправить код — попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  const recoverNext = async () => {
    if (busy) return;
    if (recoverStep === 2) {
      setBusy(true);
      try {
        await api('/api/auth/recover/verify', { challengeId: challenge?.challengeId, code: recoverCode });
        setRecoverStep(3);
        setStepError('');
        setRecoverSent(false);
      } catch (e) {
        showError(e instanceof ApiError ? e.message : 'Что-то пошло не так — попробуйте ещё раз.');
      } finally { setBusy(false); }
      return;
    }
    if (recoverStep === 3) {
      { const bad = passwordProblem(recoverPass); if (bad) { showError(bad); return; } }
      if (recoverPass !== recoverPass2) { showError('Пароли не совпали — проверьте второе поле.'); return; }
      setBusy(true);
      try {
        await api('/api/auth/recover/complete', { challengeId: challenge?.challengeId, password: recoverPass, password2: recoverPass2 });
        flash('Пароль обновлён');
        done();
      } catch (e) {
        if (e instanceof ApiError && e.status === 410) { setRecoverStep(1); setChallenge(null); }
        showError(e instanceof ApiError ? e.message : 'Что-то пошло не так — попробуйте ещё раз.');
      } finally { setBusy(false); }
      return;
    }
    await recoverSend();
  };

  // ─── Разметка ───

  const statDate = new Date(stats.day + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  // Счётчики — когда цифры стали заметными: «2 исполнителя» на входе выглядит пусто.
  const counters = ([
    [stats.freelancers, plural(stats.freelancers, 'исполнитель', 'исполнителя', 'исполнителей')],
    [stats.employers, plural(stats.employers, 'работодатель', 'работодателя', 'работодателей')]
  ] as [number, string][]).filter(([n]) => n >= STATS_MIN);
  const nextLabel = step === 1 ? 'Далее — контакты' : step === 2 ? 'Далее — профиль' : step === 3 ? (skipCode ? 'Далее — согласие' : 'Далее — код') : (isEmp ? 'Создать аккаунт работодателя' : 'Создать аккаунт исполнителя');
  const isPrivateOrg = orgType === 'частное лицо';
  const sentTo = challenge?.sentTo || email;

  return (
    <div className={sty.c66e751c}>
      <div style={css('display: grid; grid-template-columns: ' + (narrow ? 'minmax(0, 1fr)' : 'minmax(320px, .85fr) minmax(0, 1.15fr)') + '; height: 100vh; height: 100dvh; overflow: hidden; box-sizing: border-box')}>

        {/* Тёмная колонка */}
        <div style={css('overflow: hidden; padding: clamp(24px, 4vh, 46px) clamp(24px, 3.4vw, 48px); display: ' + (narrow ? 'none' : 'flex') + '; flex-direction: column; justify-content: space-between; gap: 40px; min-width: 0; box-sizing: border-box; background: var(--ink); color: #f4f2ef')}>
          <div>
            <div className={sty.cd90b459}>
              <div className={'fh ' + sty.c5f5a148}>Арена Работы</div>
              <div className={sty.c191c80f}>каждая точка — работа</div>
            </div>
            <div className={sty.cc7dbe43} />
            <h1 className={sty.cc5e75b6}>
              <span style={{ whiteSpace: 'nowrap' }}>Сезонная работа.</span><span style={{ whiteSpace: 'nowrap' }}>Смены на карте</span>
            </h1>
            <p className={sty.c47c0120}>
              Уборка снега, покос, благоустройство, стройка. Подрядчики публикуют смены точкой на карте, вы выбираете день и выходите. Отклик и чат — в одном месте.
            </p>
          </div>
          <div>
            {[['карта', 'заказы точками — ставка и адрес сразу видны'], ['отклик', 'одна кнопка, дальше чат с работодателем']].map(([k, v]) => (
              <div key={k} className={sty.c0d7d581}>
                <span className={'fh ' + sty.c28ec2b5}>{k}</span>
                <span className={sty.ce8254e2}>{v}</span>
              </div>
            ))}
            {counters.length > 0 && <>
              <div className={sty.c8bc77da} />
              <div className={sty.c483a622}>
                {counters.map(([n, l]) => (
                  <div key={l} className={sty.c9dde168}>
                    <span className={'fh ' + sty.c1607229}>{fmtNum(n)}</span>
                    <span className={'fh ' + sty.c31092bb}>{l}</span>
                  </div>
                ))}
              </div>
              <div className={sty.c444bcf2}>на площадке · данные на {statDate}</div>
            </>}
          </div>
        </div>

        {/* Форма */}
        <div className={sty.c14294e2} ref={scroller}>
          <div className={sty.c4b23b76}>
            <Link href={pending ? '/?job=' + pending.num : '/'} className={'btn btn-secondary ' + sty.cf4851b4}>← Вернуться на карту</Link>

            {pending && (
              <div className={sty.cc72862c}>
                Чтобы откликнуться на «{pending.title}», нужен профиль исполнителя
              </div>
            )}

            {mode !== 'recover' && (
              <div role="tablist" className={sty.c1d90f04}>
                <button role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')} style={segStyle(mode === 'signup')}>Регистрация</button>
                <button role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')} style={segStyle(mode === 'login')}>Вход</button>
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <div className={sty.c471c66a}>
                  {['Роль', 'Контакты', 'Профиль', skipCode ? 'Согласие' : 'Код'].map((label, i) => (
                    <div key={label} aria-current={step === i + 1 ? 'step' : undefined} style={css('flex: 1; min-width: 0; padding: 8px 9px; border: 1px solid ' + (step === i + 1 ? 'var(--color-accent)' : 'var(--color-divider)') +
                      '; background: ' + (step > i + 1 ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : step === i + 1 ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'transparent') +
                      '; color: ' + (step >= i + 1 ? 'var(--color-accent-900)' : 'color-mix(in srgb, var(--color-text) 64%, transparent)'))}>
                      <div className={'fh ' + sty.c7ebe848}>0{i + 1}</div>
                      <div className={'fh ' + sty.c67978cf}>{label}</div>
                    </div>
                  ))}
                </div>

                {oauth && (
                  <div style={css(NOTE + '; margin: 0 0 14px; padding: 9px 11px; border: 1px solid var(--color-accent); background: color-mix(in srgb, var(--color-accent) 8%, transparent)')}>
                    Данные получены из {oauth.providerName}: имя{oauth.email ? ' и почта' : ''}. Выберите роль и заполните профиль{skipCode ? ' — код подтверждения не понадобится.' : '; почту подтвердим кодом из письма.'}
                  </div>
                )}

                {step === 1 && (
                  <div>
                    {!oauth && <OAuthButtons providers={oauthProviders} apply={pending?.num} lead="Быстрая регистрация — данные заполнятся сами:" />}
                    <h3 className={sty.c93ff964}>Кто вы</h3>
                    <div className={sty.c543bc33}>Роль определяет профиль и права на карте</div>
                    <div className={sty.c07c5a89}>
                      <button aria-pressed={role === 'freelancer'} onClick={() => setRole('freelancer')} style={roleCardStyle(role === 'freelancer')}>
                        <div className={'fh ' + sty.cfcbd5ca}>Исполнитель</div>
                        <div className={sty.cf952b9a}>Ищу сезонные смены рядом с домом</div>
                      </button>
                      <button aria-pressed={role === 'employer'} onClick={() => setRole('employer')} style={roleCardStyle(role === 'employer')}>
                        <div className={'fh ' + sty.cfcbd5ca}>Работодатель</div>
                        <div className={sty.cf952b9a}>Публикую заказы и нанимаю людей</div>
                      </button>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <h3 style={css(H3)}>Контакты</h3>
                    <div className={sty.c82a9418}>
                      <div className="field">
                        <label htmlFor="su-name">{isEmp ? 'Контактное лицо' : 'Имя и фамилия'} <span style={css(REQ)}>обязательно</span></label>
                        <input id="su-name" className="input" value={name} onChange={e => { setName(e.target.value); setStepError(''); }} placeholder={isEmp ? 'Айгуль Тлеубаева' : 'Данияр Сапаров'} autoComplete="name" style={css(missStyle('name', true))} />
                      </div>
                      <div className="field">
                        <label htmlFor="su-email">E-mail <span style={css(REQ)}>обязательно</span></label>
                        <input id="su-email" className="input" type="email" value={email} onChange={e => { setEmail(e.target.value); setStepError(''); }} placeholder="name@mail.ru" autoComplete="email" style={css(missStyle('email', true))} />
                        <span style={css(HINT)}>{skipCode
                          ? 'Почта подтверждена в ' + oauth?.providerName + ' — код не понадобится.'
                          : 'Придёт письмо с кодом из шести цифр. По почте или логину — вход.'}</span>
                      </div>
                      <div className="field">
                        <label htmlFor="su-login">Логин <span style={css(REQ)}>обязательно</span></label>
                        <input id="su-login" className="input" value={login} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                          onChange={e => { const raw = e.target.value; setLogin(raw.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 20)); setLoginCyr(/[а-яё]/i.test(raw)); setStepError(''); }}
                          placeholder="daniyar_s" autoComplete="username" style={css(missStyle('login', true))} />
                        {/* Русские буквы в логин не попадают — без подсказки кажется, что поле «не печатает». */}
                        {loginCyr && <span role="status" style={css(HINT + '; color: var(--color-accent-700)')}>Русские буквы в логине нельзя — переключите клавиатуру на латиницу (EN).</span>}
                        <span style={css(HINT)}>Латиница, цифры, точка и подчёркивание, 3–20 символов. Нужен для входа; потом его не изменить.</span>
                      </div>
                      {!oauth && (
                        <div className="field">
                          <label htmlFor="su-pass">Пароль <span style={css(REQ)}>обязательно</span></label>
                          <PasswordInput id="su-pass" className="input" value={pass} onChange={e => { setPass(e.target.value); setStepError(''); }} placeholder="не короче 8 символов" autoComplete="new-password" style={css(missStyle('pass', true))} />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor="su-city">Город <span style={css(REQ)}>обязательно</span></label>
                        <CityInput id="su-city" value={city} onChange={v => { setCity(v); setStepError(''); }} placeholder="Начните вводить — например, Москва" style={css(missStyle('city', true))} />
                      </div>
                    </div>
                  </div>
                )}

                {step === 3 && !isEmp && (
                  <div>
                    <h3 style={css(H3)}>Профиль исполнителя</h3>
                    <div style={css(NOTE + '; margin: -6px 0 16px')}>Всё это можно поменять потом в профиле.</div>
                    <div style={css(LABEL + '; margin-bottom: 8px')}>Что умеете</div>
                    <div style={css('display: flex; flex-wrap: wrap; gap: 6px; padding: 4px; ' + missStyle('skills', false))}>
                      {JOB_TYPES.map(t => <Chip key={t.id} active={skills.includes(t.id)} onClick={() => { toggle(skills, setSkills, t.id); setStepError(''); }}>{t.label}</Chip>)}
                      {customSkills.map(label => <Chip key={'c' + label} active onClick={() => setCustomSkills(s => s.filter(x => x !== label))}>{label}</Chip>)}
                    </div>
                    <div className={sty.cb724174}>
                      <input className="input" aria-label="Свой навык" value={skillDraft} onChange={e => setSkillDraft(e.target.value)} onKeyDown={onEnter(() => addCustom('skill'))} placeholder="свой навык — например, вывоз снега на прицепе" style={css(DRAFT_INPUT)} />
                      <button className={'btn btn-secondary ' + sty.c27fa87c} onClick={() => addCustom('skill')}>Добавить</button>
                    </div>
                    {/* Инвентарь — по желанию и свёрнут: шаг короче, а кому есть что указать — раскроет. */}
                    <div className={sty.c6840f0a}>
                      <div className={sty.cfd1ed7d}>
                        <div style={css(LABEL)}>Инвентарь</div>
                        <span className={sty.c347d421}>необязательно</span>
                      </div>
                      {!showGear ? (
                        <>
                          <button type="button" className={'btn btn-secondary ' + sty.c27fa87c + ' ' + sty.gearOpen} onClick={() => setGearOpen(true)}>+ Указать свой инвентарь</button>
                          <div style={css(NOTE)}>Работодатель увидит в отклике, с чем вы придёте.</div>
                        </>
                      ) : (
                        <>
                          {gearFirst.length > 0 && <div style={css(NOTE + '; margin: 6px 0 8px')}>Сначала — то, что пригодится для отмеченных работ.</div>}
                          <div className={sty.c2bf69bb} style={gearFirst.length ? undefined : { marginTop: 8 }}>
                            {gearOrder.map(g => <Chip key={g} active={gear.includes(g)} onClick={() => pickGear(g)}>{g}</Chip>)}
                            {customGear.map(g => <Chip key={'c' + g} active onClick={() => { setCustomGear(s => s.filter(x => x !== g)); setGear(s => s.filter(x => x !== g)); }}>{g}</Chip>)}
                          </div>
                          <div className={sty.cb724174}>
                            <input className="input" aria-label="Свой инвентарь" value={gearDraft} onChange={e => setGearDraft(e.target.value)} onKeyDown={onEnter(() => addCustom('gear'))} placeholder="например, мотобур" style={css(DRAFT_INPUT)} />
                            <button className={'btn btn-secondary ' + sty.c27fa87c} onClick={() => addCustom('gear')}>Добавить</button>
                          </div>
                          <div style={css(NOTE)}>Выбранное подсвечено — нажмите ещё раз, чтобы убрать.</div>
                        </>
                      )}
                    </div>
                    <div className={sty.c6840f0a}>
                      <div className="field">
                        <label htmlFor="su-cities" style={css(LABEL + '; margin-bottom: 8px')}>Города, где вы работаете</label>
                        <div className={sty.caea80b7}>
                          <CityInput id="su-cities" wrapStyle={{ flex: 1, minWidth: 160 }} style={css('border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 8%, transparent); color: var(--color-accent-900); --placeholder-color: var(--color-accent-700); ' + missStyle('cities', false))}
                            value={cityDraft} onChange={setCityDraft} onPick={addCity} onKeyDown={onEnter(() => addCity())} placeholder="начните вводить город" />
                          <button className={'btn btn-secondary ' + sty.c27fa87c + ' ' + sty.cec058aa} onClick={() => addCity()}>Добавить</button>
                        </div>
                      </div>
                      <div className={sty.ca8e3223}>
                        {workCities.map(label => <Chip key={label} active onClick={() => setWorkCities(c => c.filter(x => x !== label))}>{label}</Chip>)}
                      </div>
                      <div style={css(NOTE)}>Смены в этих городах будут в ленте и уведомлениях. Нажмите на город, чтобы убрать его.</div>
                    </div>
                    <label className={sty.c1200285}>
                      <input type="checkbox" checked={ownCar} onChange={e => setOwnCar(e.target.checked)} className={sty.ca42a1ef} />
                      Есть свой транспорт для перевозки инвентаря
                    </label>
                  </div>
                )}

                {step === 3 && isEmp && (
                  <div>
                    <h3 style={css(H3)}>Профиль работодателя</h3>
                    <div style={css(NOTE + '; margin: -6px 0 16px')}>Всё это можно поменять потом в профиле.</div>
                    <div style={css(LABEL + '; margin-bottom: 8px')}>Тип работодателя</div>
                    <select className={'input ' + sty.c66998fc} aria-label="Тип работодателя" value={orgType} onChange={e => setOrgType(e.target.value)}>
                      {ORG_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <div className={sty.c5ca8ba3}>
                      <div className="field">
                        <label htmlFor="su-org">{isPrivateOrg ? 'ФИО работодателя' : 'Название организации'}</label>
                        <input id="su-org" className="input" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder={isPrivateOrg ? 'Айгуль Тлеубаева' : 'УК «Тверская»'} />
                      </div>
                      <div className="field">
                        <label htmlFor="su-objkind">Объекты обслуживания</label>
                        <select id="su-objkind" className="input" value={objectKind} onChange={e => setObjectKind(e.target.value)}>
                          {OBJECT_KINDS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      {objectKind === 'свой вариант' && (
                        <div className="field">
                          <label htmlFor="su-objother">Свой объект обслуживания</label>
                          <input id="su-objother" className="input" value={objectOther} onChange={e => setObjectOther(e.target.value)} placeholder="например, территория автомойки" />
                        </div>
                      )}
                    </div>

                    <div className={sty.c6840f0a}>
                      <div className={sty.cfd1ed7d}>
                        <div style={css(LABEL)}>Доступ на объект</div>
                        <span className={sty.c347d421}>обязательно</span>
                      </div>
                      <div style={css('display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding: 4px; ' + missStyle('access', false))}>
                        {ACCESS.map(a => <Chip key={a} active={access.includes(a)} onClick={() => { toggle(access, setAccess, a); setStepError(''); }}>{a}</Chip>)}
                      </div>
                    </div>

                    <div className={sty.c6840f0a}>
                      <div className={sty.cfd1ed7d}>
                        <div style={css(LABEL)}>Инвентарь на объекте</div>
                        <span className={sty.c347d421}>обязательно</span>
                      </div>
                      <div style={css('display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding: 4px; ' + missStyle('tools', false))}>
                        {TOOLS.map(t => <Chip key={t} active={tools === t} onClick={() => { setTools(t); setStepError(''); }}>{t}</Chip>)}
                      </div>
                    </div>

                    {isPrivateOrg ? (
                      <div className={sty.c217b1cc}>
                        <div className="field">
                          <label htmlFor="su-meet">Кто встречает на объекте</label>
                          <input id="su-meet" className="input" value={meetName} onChange={e => setMeetName(e.target.value)} placeholder="я сам, коллега" />
                        </div>
                        <div className="field">
                          <label htmlFor="su-meetphone">Телефон встречающего</label>
                          <input id="su-meetphone" className="input" type="tel" value={meetPhone} onChange={e => setMeetPhone(e.target.value)} placeholder="+7 900 000-00-00" />
                        </div>
                      </div>
                    ) : (
                      <div className={sty.c6840f0a}>
                        <div style={css(LABEL)}>Пропуск на территорию</div>
                        <div className={sty.c520f760}>
                          {PASS_MODES.map(p => <Chip key={p} active={passMode === p} onClick={() => setPassMode(p)}>{p}</Chip>)}
                        </div>
                        {passMode === 'нужен пропуск' && (
                          <div className={'field ' + sty.c4bb9003}>
                            <label htmlFor="su-passwhom">На кого оформлять пропуск</label>
                            <input id="su-passwhom" className="input" value={passWhom} onChange={e => setPassWhom(e.target.value)} placeholder="ФИО исполнителя, за сутки, на охрану корпуса Б" />
                          </div>
                        )}
                        <div style={css(LABEL + '; margin-top: 18px')}>Охрана труда</div>
                        <div className={sty.c520f760}>
                          {SAFETY_REQ.map(s => <Chip key={s} active={safetyReq.includes(s)} onClick={() => toggle(safetyReq, setSafetyReq, s)}>{s}</Chip>)}
                        </div>
                      </div>
                    )}

                    <div className={sty.c35a8d17}>
                      Адрес, доступ, инвентарь и требования видны в карточке заказа сразу. Телефон встречающего открывается исполнителю только после найма. В каждом новом заказе эти условия спрашиваем заново — объекты и смены разные.
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div>
                    <h3 className={sty.c93ff964}>{skipCode ? 'Последний шаг' : 'Подтверждение'}</h3>
                    {skipCode ? (
                      <div className={sty.cd2d7539}>Почта подтверждена в {oauth?.providerName}. Осталось принять оферту и дать согласие на обработку данных — и аккаунт готов. Входить потом — той же кнопкой «{oauth?.providerName}».</div>
                    ) : (<>
                    <div className={sty.cd2d7539}>
                      Код из шести цифр отправлен на <b>{sentTo}</b> · действует 10 минут. Письма нет — проверьте папку «Спам».
                    </div>
                    <div className={sty.c318e55a}>
                      <div className={sty.cb9b7b53}>
                        {Array.from({ length: CODE_LEN }, (_, i) => i).map(i => (
                          <div key={i} style={css('width: 42px; height: 52px; display: grid; place-items: center; font-family: var(--font-heading); font-size: 24px; border: 1px solid ' +
                            (code.length === i ? 'var(--color-accent)' : 'var(--color-divider)') + '; color: ' + (code[i] ? 'var(--color-text)' : 'color-mix(in srgb, var(--color-text) 35%, transparent)'))}>{code[i] || '·'}</div>
                        ))}
                      </div>
                      <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} aria-label="Код подтверждения" autoFocus
                        onChange={e => { if (attemptsLeft > 0) { setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LEN)); setCodeError(''); } }}
                        // eslint-disable-next-line react-hooks/refs -- onEnter возвращает обработчик события, ref читается только при нажатии
                        onKeyDown={onEnter(nextStep)}
                        className={sty.ccf7c69e} />
                    </div>
                    {codeError && <div role="alert" className={sty.c783df3c}>{codeError}</div>}
                    <div className={sty.cbea37fd}>
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '←'].map(k => (
                        <button key={k} onClick={() => typeCode(k)} className={'btn btn-secondary ' + 'fh ' + sty.cfb4081f} aria-label={k === '←' ? 'Стереть' : k}>{k}</button>
                      ))}
                    </div>
                    <div className={sty.cf4bc04d}>
                      <button className={'btn btn-ghost ' + sty.c8dc805f} onClick={resend} disabled={resendIn > 0 || busy}>
                        {'Прислать код ещё раз' + (resendIn > 0 ? ' через ' + Math.floor(resendIn / 60) + ':' + String(resendIn % 60).padStart(2, '0') : '')}
                      </button>
                    </div>
                    {challenge?.devCode && <div className={sty.cf8e1b45}>Режим разработки: код {challenge.devCode} (письма не отправляются, а пишутся в журнал)</div>}
                    </>)}
                    <label className={sty.c2ff6e93}>
                      <input type="checkbox" checked={offerAccepted} onChange={e => { setOfferAccepted(e.target.checked); if (e.target.checked && pdConsent) setOfferError(''); }} className={sty.cdf98b21} />
                      <span>Мне есть 18 лет, принимаю <Link href="/legal/offer" target="_blank">оферту</Link> и <Link href="/legal/rules" target="_blank">правила площадки</Link>. Площадка — посредник: договор о работах стороны заключают между собой.</span>
                    </label>
                    <label className={sty.c2ff6e93}>
                      <input type="checkbox" checked={pdConsent} onChange={e => { setPdConsent(e.target.checked); if (e.target.checked && offerAccepted) setOfferError(''); }} className={sty.cdf98b21} />
                      <span>Даю <Link href="/legal/consent" target="_blank">согласие на обработку персональных данных</Link> на условиях <Link href="/legal/personal-data" target="_blank">политики</Link>.</span>
                    </label>
                    {offerError && <div role="alert" style={{ ...css('font-size: 13.5px; font-weight: 600; line-height: 1.4; margin-top: 8px; color: var(--color-accent-900); border: 2px solid var(--color-accent-700); padding: 8px 10px; background: var(--color-accent-100)'), animation: stepErrAnim }}>{offerError}</div>}
                  </div>
                )}

                {stepError && <div role="alert" style={{ ...css(ALERT), animation: stepErrAnim }}>{stepError}</div>}
                <div className={sty.c115257a + ' ' + sty.stepNav}>
                  {step > 1 && <button className={'btn btn-secondary ' + sty.c61fef2d} onClick={() => { setStep(s => Math.max(1, s - 1)); setStepError(''); }}>Назад</button>}
                  <button className="btn btn-primary blueprint" onClick={nextStep} disabled={busy} style={css('flex: 1; ' + PRIMARY)}>
                    <Corners />{nextLabel}
                  </button>
                </div>
                <button onClick={() => switchMode('recover')} style={css(LINK_BTN)}>Восстановление аккаунта →</button>
              </div>
            )}

            {mode === 'login' && <OAuthButtons providers={oauthProviders} apply={pending?.num} lead="Без пароля — через ваш аккаунт:" />}
            {mode === 'login' && (
              <form onSubmit={e => { e.preventDefault(); doLogin(); }}>
                <div className={sty.c82a9418}>
                  <div className="field">
                    <label htmlFor="li-id">Почта или логин</label>
                    <input id="li-id" className="input" value={identifier} onChange={e => { setIdentifier(e.target.value); setStepError(''); }} placeholder="name@mail.ru или daniyar_s" autoComplete="username" />
                  </div>
                  <div className="field">
                    <label htmlFor="li-pass">Пароль</label>
                    <PasswordInput id="li-pass" className="input" value={pass} onChange={e => { setPass(e.target.value); setStepError(''); }} placeholder="••••••••" autoComplete="current-password" />
                    <button type="button" onClick={() => switchMode('recover')} style={css('justify-self: start; margin-top: 6px; ' + UNDERLINE_BTN)}>Забыли пароль?</button>
                  </div>
                </div>
                <div className={sty.c16b060d}>Кабинет откроется в той роли, в которой вы регистрировались. Для второй роли нужен отдельный аккаунт.</div>
                {stepError && <div role="alert" style={{ ...css(ALERT), animation: stepErrAnim }}>{stepError}</div>}
                <button type="submit" className="btn btn-primary btn-block blueprint" disabled={busy} style={css('margin-top: 22px; ' + PRIMARY)}>
                  <Corners />Войти
                </button>
              </form>
            )}

            {mode === 'recover' && (
              <div>
                <div style={css(LABEL)}>Доступ</div>
                <h3 className={sty.c7aae9d4}>Восстановление аккаунта</h3>
                <div className={sty.cb19513b}>
                  {recoverStep === 2
                    ? 'Мы отправили код из шести цифр на почту аккаунта «' + (identifier.trim() || 'аккаунт') + '». Письма нет — проверьте папку «Спам».'
                    : recoverStep === 3
                      ? 'Код принят. Задайте новый пароль — старый перестанет работать сразу после сохранения.'
                      : 'Укажите почту или логин аккаунта — на почту аккаунта придёт код из шести цифр. Так же задают пароль те, кто входил через Яндекс ID или VK ID.'}
                </div>
                <div className={'field ' + sty.c6840f0a}>
                  <label htmlFor="rc-field">{recoverStep === 2 ? 'Код из письма' : recoverStep === 3 ? 'Новый пароль' : 'Почта или логин'}</label>
                  {recoverStep === 1 && <input id="rc-field" className="input" value={identifier} onChange={e => { setIdentifier(e.target.value); setStepError(''); }} onKeyDown={onEnter(recoverNext)} placeholder="name@mail.ru или daniyar_s" autoComplete="username" />}
                  {recoverStep === 2 && <input id="rc-field" className={'input ' + 'fh ' + sty.ca9baefc} value={recoverCode} onChange={e => { setRecoverCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LEN)); setStepError(''); }} onKeyDown={onEnter(recoverNext)} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus />}
                  {recoverStep === 3 && <PasswordInput id="rc-field" className="input" value={recoverPass} onChange={e => { setRecoverPass(e.target.value); setStepError(''); }} placeholder="не короче 8 символов" autoComplete="new-password" autoFocus />}
                </div>
                {recoverStep === 3 && (
                  <div className={'field ' + sty.c691f5a5}>
                    <label htmlFor="rc-pass2">Повторите пароль</label>
                    <PasswordInput id="rc-pass2" className="input" value={recoverPass2} onChange={e => { setRecoverPass2(e.target.value); setStepError(''); }} onKeyDown={onEnter(recoverNext)} placeholder="ещё раз" autoComplete="new-password" />
                  </div>
                )}
                {stepError && <div role="alert" style={{ ...css(ALERT), animation: stepErrAnim }}>{stepError}</div>}
                {recoverSent && recoverStep === 2 && (
                  <div className={sty.c48c42b0}>
                    Если аккаунт «{identifier.trim()}» существует, письмо с кодом придёт в течение минуты.{challenge?.devCode ? ' Режим разработки: код ' + challenge.devCode + '.' : ''}
                  </div>
                )}
                <button className="btn btn-primary btn-block blueprint" onClick={recoverNext} disabled={busy} style={css('margin-top: 22px; ' + PRIMARY)}>
                  <Corners />{recoverStep === 2 ? 'Подтвердить код' : recoverStep === 3 ? 'Сохранить пароль и войти' : 'Прислать код восстановления'}
                </button>
                {recoverStep === 2 && <button onClick={() => recoverSend()} disabled={busy} style={css('margin-top: 12px; ' + UNDERLINE_BTN)}>Прислать код ещё раз</button>}
                <div><button onClick={() => switchMode('login')} style={css(LINK_BTN)}>← Вернуться ко входу</button></div>
              </div>
            )}

            <DocLinks newTab style="margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--color-divider)" />
          </div>
        </div>
      </div>
    </div>
  );
}
