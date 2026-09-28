// Проверки полей регистрации/входа — общие для клиента и сервера. Тексты ошибок — из прототипа.
import { ACCESS, GEAR, JOB_TYPE_IDS, OBJECT_KINDS, ORG_TYPES, PASS_MODES, SAFETY_REQ, TOOLS } from './catalog';

export type Role = 'freelancer' | 'employer';
export type FieldError = { field: string; message: string };

export const LOGIN_RE = /^[a-zA-Z0-9._]{3,20}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_LIKE_RE = /^[+\d\s()\-]+$/;

export function digitsOf(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

/** Ключ телефона: последние 10 цифр (README: «сравнение по последним 10»). */
export function phoneKey(v: string): string | null {
  const d = digitsOf(v);
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Телефон для хранения и отображения: +7XXXXXXXXXX. */
export function normalizePhone(v: string): string | null {
  const k = phoneKey(v);
  return k ? '+7' + k : null;
}

export function formatPhone(v: string): string {
  const k = phoneKey(v);
  if (!k) return v;
  return `+7 ${k.slice(0, 3)} ${k.slice(3, 6)}-${k.slice(6, 8)}-${k.slice(8)}`;
}

/** Логин или телефон: строка из [+\d\s()-] — телефон, иначе логин. */
export function parseIdentifier(raw: string): { kind: 'phone'; key: string } | { kind: 'login'; login: string } | { kind: 'invalid'; message: string } {
  const t = String(raw || '').trim();
  if (!t) return { kind: 'invalid', message: 'Введите логин или номер телефона.' };
  if (PHONE_LIKE_RE.test(t)) {
    const key = phoneKey(t);
    if (!key) return { kind: 'invalid', message: 'В номере телефона не хватает цифр — нужно минимум 10.' };
    return { kind: 'phone', key };
  }
  if (!LOGIN_RE.test(t)) return { kind: 'invalid', message: 'Логин — 3–20 символов: латиница, цифры, точка или подчёркивание.' };
  return { kind: 'login', login: t };
}

export type Contacts = {
  name: string;
  phone: string;
  login: string;
  password: string;
  email: string;
  city: string;
};

export type FreelancerProfile = {
  skills: string[];
  customSkills: string[];
  gear: string[];
  customGear: string[];
  ownCar: boolean;
  workCities: string[];
};

export type EmployerProfile = {
  orgType: string;
  orgName: string;
  objectKind: string;
  objectOther: string;
  access: string[];
  tools: string;
  meetName: string;
  meetPhone: string;
  passMode: string;
  passWhom: string;
  safetyReq: string[];
};

export type SignupInput = Contacts & {
  role: Role;
  freelancer?: FreelancerProfile;
  employer?: EmployerProfile;
};

/** Все пропущенные поля шага «Контакты» по порядку; первое — для текста ошибки. */
export function contactsMissing(c: Partial<Contacts>, opts: { requirePassword?: boolean } = {}): string[] {
  const miss: string[] = [];
  if ((c.name || '').trim().length < 2) miss.push('name');
  if (digitsOf(c.phone || '').length < 10) miss.push('phone');
  if (!LOGIN_RE.test((c.login || '').trim())) miss.push('login');
  if (opts.requirePassword !== false && (c.password || '').length < 6) miss.push('password');
  if (!EMAIL_RE.test((c.email || '').trim())) miss.push('email');
  if (!(c.city || '').trim()) miss.push('city');
  return miss;
}

export function contactsMessage(field: string, email: string): string {
  switch (field) {
    case 'name': return 'Укажите имя и фамилию — их видит вторая сторона в чате.';
    case 'phone': return 'Телефон нужен для кода подтверждения и связи на смене — минимум 10 цифр.';
    case 'login': return 'Придумайте логин: 3–20 символов — латиница, цифры, точка или подчёркивание.';
    case 'password': return 'Пароль — не короче 6 символов.';
    case 'email': return email.trim() ? 'Проверьте e-mail — похоже, в адресе опечатка.' : 'Укажите e-mail — на него придут чеки и важные уведомления.';
    default: return 'Укажите город — по нему подбираются смены рядом.';
  }
}

export function validateContacts(c: Partial<Contacts>, opts?: { requirePassword?: boolean }): FieldError | null {
  const miss = contactsMissing(c, opts);
  if (!miss.length) return null;
  return { field: miss[0], message: contactsMessage(miss[0], c.email || '') };
}

export function validateProfile(role: Role, p: { freelancer?: Partial<FreelancerProfile>; employer?: Partial<EmployerProfile> }): FieldError | null {
  if (role === 'employer') {
    const e = p.employer || {};
    if (!(e.access || []).length) return { field: 'access', message: 'Отметьте, как попасть на объект — это первый вопрос исполнителя.' };
    if (!e.tools) return { field: 'tools', message: 'Отметьте, чей инвентарь на смене.' };
    return null;
  }
  const f = p.freelancer || {};
  if (!(f.skills || []).length && !(f.customSkills || []).length) return { field: 'skills', message: 'Отметьте хотя бы один вид работ — по нему подбираются смены.' };
  if (!(f.workCities || []).length) return { field: 'cities', message: 'Добавьте хотя бы один город, где вы работаете.' };
  return null;
}

export function takenMessage(by: 'phone' | 'login', role: Role): string {
  return (by === 'phone' ? 'Этот номер' : 'Этот логин') + ' уже зарегистрирован — как ' +
    (role === 'employer' ? 'работодатель' : 'исполнитель') +
    '. Один аккаунт — одна роль: войдите или укажите ' + (by === 'phone' ? 'другой номер.' : 'другой логин.');
}

// ─── Санитайзинг входных данных на сервере ───

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems) : [];
const oneOf = (v: unknown, list: string[], fallback = '') => (typeof v === 'string' && list.includes(v) ? v : fallback);

export function sanitizeSignup(raw: unknown): SignupInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const role: Role = r.role === 'employer' ? 'employer' : 'freelancer';
  const out: SignupInput = {
    role,
    name: str(r.name, 120),
    phone: str(r.phone, 32),
    login: str(r.login, 20),
    password: typeof r.password === 'string' ? r.password.slice(0, 200) : '',
    email: str(r.email, 200),
    city: str(r.city, 80)
  };
  if (role === 'freelancer') {
    const f = (r.freelancer && typeof r.freelancer === 'object' ? r.freelancer : {}) as Record<string, unknown>;
    const customGear = strList(f.customGear, 8, 60);
    out.freelancer = {
      skills: strList(f.skills, 30, 40).filter(s => JOB_TYPE_IDS.includes(s)),
      customSkills: strList(f.customSkills, 8, 60),
      gear: strList(f.gear, 40, 60).filter(g => GEAR.includes(g) || customGear.includes(g)),
      customGear,
      ownCar: f.ownCar === true,
      workCities: strList(f.workCities, 20, 80)
    };
  } else {
    const e = (r.employer && typeof r.employer === 'object' ? r.employer : {}) as Record<string, unknown>;
    out.employer = {
      orgType: oneOf(e.orgType, ORG_TYPES, 'частное лицо'),
      orgName: str(e.orgName, 160),
      objectKind: oneOf(e.objectKind, OBJECT_KINDS, 'частный двор'),
      objectOther: str(e.objectOther, 120),
      access: strList(e.access, 10, 60).filter(a => ACCESS.includes(a)),
      tools: oneOf(e.tools, TOOLS),
      meetName: str(e.meetName, 80),
      meetPhone: str(e.meetPhone, 32),
      passMode: oneOf(e.passMode, PASS_MODES),
      passWhom: str(e.passWhom, 200),
      safetyReq: strList(e.safetyReq, 10, 60).filter(s => SAFETY_REQ.includes(s))
    };
  }
  return out;
}

/** Текстовые поля анкеты для модерации: машинное имя, подпись поля, значение. */
export function signupTextFields(s: SignupInput): { field: string; label: string; value: unknown }[] {
  const list: { field: string; label: string; value: unknown }[] = [
    { field: 'name', label: s.role === 'employer' ? 'Контактное лицо' : 'Имя и фамилия', value: s.name },
    { field: 'login', label: 'Логин', value: s.login },
    { field: 'email', label: 'E-mail', value: s.email },
    { field: 'city', label: 'Город', value: s.city }
  ];
  if (s.freelancer) {
    list.push(
      { field: 'skills', label: 'Свой навык', value: s.freelancer.customSkills },
      { field: 'gear', label: 'Свой инвентарь', value: s.freelancer.customGear },
      { field: 'cities', label: 'Города, где вы работаете', value: s.freelancer.workCities }
    );
  }
  if (s.employer) {
    list.push(
      { field: 'orgName', label: s.employer.orgType === 'частное лицо' ? 'ФИО работодателя' : 'Название организации', value: s.employer.orgName },
      { field: 'objectOther', label: 'Свой объект обслуживания', value: s.employer.objectOther },
      { field: 'meetName', label: 'Кто встречает на объекте', value: s.employer.meetName },
      { field: 'passWhom', label: 'На кого оформлять пропуск', value: s.employer.passWhom }
    );
  }
  return list;
}
