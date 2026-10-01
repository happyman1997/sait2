// Заказы: общие для клиента и сервера типы, проверки формы и форматирование (тексты — из прототипа).
import { CREW_ANY, MONTHS_GEN, PAY_TYPES, REPEATS, TOOLS, UNITS } from './catalog';

export type JobStatus = 'open' | 'staffed' | 'reported' | 'accepted' | 'cancelled';
export type AppStatus = 'sent' | 'hired' | 'rejected' | 'withdrawn';

/** Заказ в списке и на карте. */
export type JobSummary = {
  num: number;
  title: string;
  typeId: string;
  typeLabel: string;
  address: string;
  district: string | null;
  lat: number;
  lng: number;
  pay: number;
  unit: string;
  payType: string | null;
  date: string;              // YYYY-MM-DD
  volume: string | null;
  crew: number;
  urgent: boolean;
  repeat: string | null;
  status: JobStatus;
  hired: number;
  applicants: number;
  mine: boolean;             // заказ текущего работодателя
  myStatus: AppStatus | null; // отклик текущего исполнителя
  distanceKm: number | null;
  createdAt: string;
};

export type Applicant = {
  id: string;                 // id отклика — по нему нанимают/отказывают
  thread: string;             // диалог с исполнителем (id исполнителя)
  name: string;
  initials: string;
  rating: number | null;
  done: number;
  noShows: number;
  gear: string;
  status: AppStatus;
  isLead: boolean;
  appliedAt: string;
  npd: boolean;               // самозанятый, статус подтверждён ФНС
};

export type JobDetail = JobSummary & {
  description: string;
  requirement: string | null;
  repeatNote: string | null;
  access: string[];
  tools: string | null;
  meetName: string | null;
  meetPhone: string | null;   // только нанятому и владельцу
  payWhen: string | null;
  employer: { name: string; initials: string; orgType: string; rating: number | null; reviews: number; jobs: number; since: string };
  cancellation: { reason: string; notice: string; late: boolean; at: string } | null;
  applicantList: Applicant[] | null; // только владельцу
  shift: ShiftInfo | null;
  series: SeriesInfo | null;         // только для регулярных заказов           // только участникам смены (владелец, нанятые)
};

/** Смена глазами участника: кто нанят, сдача, приёмка, расчёт, отзывы и жалоба текущего пользователя. */
export type ShiftInfo = {
  hired: { appId: string | null; thread: string | null; name: string; isLead: boolean; me: boolean }[];
  leadName: string | null;
  iAmLead: boolean;
  reportedAt: string | null;
  autoAcceptAt: string | null;       // когда закроется автоматически
  acceptedAt: string | null;
  autoAccepted: boolean;
  settle: { employer: boolean; freelancer: boolean } | null;
  myReviews: { target: string; targetName: string; rating: number; text: string; editable: boolean }[];
  reviewTargets: { target: string; name: string }[];  // кого можно оценить (id отклика или 'employer')
  myComplaint: { reason: string; at: string } | null;
  canChat: boolean;
  myThread: string | null;          // свой диалог исполнителя с работодателем
  withdrawal: { reason: string; notice: string; late: boolean; at: string } | null;  // мой отказ от смены
  noShow: boolean;                   // меня отметили «Не вышел»
  photos: { id: string; kind: 'before' | 'after'; url: string; mine: boolean }[];
  /** Споры по расчёту: работодатель видит все по заказу, исполнитель — свой. */
  disputes: DisputeInfo[];
  /** Можно открыть спор (смена сдана/принята, у пары нет незакрытого спора). */
  canDispute: boolean;
  /** Чек-лист «Перед выходом»: работодатель видит всех нанятых, исполнитель — свой. */
  safety: { name: string; items: string[]; me: boolean }[];
};

/** Спор по расчёту: причины для каждой стороны (прототип, DISPUTE_REASONS). */
export const DISPUTE_REASONS = {
  freelancer: ['оплата не пришла в срок', 'заплатили меньше договорённого', 'работу не приняли без причины'],
  employer: ['исполнитель требует больше договорённого', 'работа выполнена не полностью']
} as const;

export type DisputeInfo = {
  id: string; num: string; status: 'open' | 'review' | 'paid' | 'withdrawn' | 'resolved';
  openedBy: 'employer' | 'freelancer'; mine: boolean; other: string; appId: string | null;
  reason: string; sum: number; text: string; response: string | null; resolution: string | null; resolvedFor: 'employer' | 'freelancer' | null;
  evidence: { ok: boolean; label: string }[]; at: string; closedAt: string | null;
};

/** Серия выходов регулярного заказа (для карточки). */
export type SeriesInfo = {
  rule: string;                 // «ежедневно, будни · до 9 утра»
  onCall: boolean;              // по снегопаду — дни серии это вызовы работодателя на дату
  days: {
    i: number; date: string | null; label: string; skipped: boolean; skippedBy: number; past: boolean;
    free: number;                                   // мест на день: снявшие минус взятые на замену
    mySub: 'sent' | 'hired' | 'rejected' | null;    // мой отклик на замену (исполнитель не из смены)
    subs: { id: string; name: string; status: 'sent' | 'hired' | 'rejected' }[];  // отклики на замену (работодателю)
    /** Сдача, приёмка и расчёт дня — работодателю и тем, кто в серии или выходит в этот день. */
    work: SeriesDayWork | null;
    /** Работодатель может отменить вызов (день ещё не наступил и не сдан). */
    canUncall: boolean;
  }[];
  canSkip: boolean;             // нанятый исполнитель
  canSub: boolean;              // исполнитель не из смены может выйти на замену в свободный день
  canExtend: boolean;           // работодатель, серия не закрыта
  canCall: boolean;             // работодатель может вызвать бригаду на дату («по снегопаду»)
  /** Отзывы о заменах: работодатель — о тех, кто выходил в принятые дни не из состава; замена — о работодателе. */
  reviews: { target: string; name: string; mine: { rating: number; text: string; editable: boolean } | null; complained: boolean }[];
};

export const SERIES_STEP = 4;   // «Продлить серию на месяц» — плюс 4 выхода (как в прототипе)
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/**
 * Даты серии по правилу повтора: будни — пн–пт, 2/2 — два дня через два, раз в неделю — каждые 7 дней,
 * иначе ежедневно. «По снегопаду» — null: выходы по вызову.
 */
export function seriesDates(repeat: string, startISO: string, count: number): string[] | null {
  if (/снегопад/.test(repeat)) return null;
  const out: string[] = [];
  const d = new Date(startISO + 'T12:00:00Z');
  const weekdays = /будни/.test(repeat);
  if (weekdays) while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  for (let k = 0; out.length < count && k < 800; k++) {
    const dow = d.getUTCDay();
    const ok = weekdays ? dow !== 0 && dow !== 6 : /2\/2/.test(repeat) ? k % 4 < 2 : /неделю/.test(repeat) ? k % 7 === 0 : true;
    if (ok) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Сдача, приёмка и расчёт одного дня серии. */
export type SeriesDayWork = {
  reportedAt: string | null;
  acceptedAt: string | null;
  autoAccepted: boolean;
  autoAcceptAt: string | null;       // сдан и не принят — когда засчитается сам
  employerPaid: boolean;
  freelancerPaid: boolean;
  workers: number;                   // сколько выходит в этот день (состав минус снявшие плюс замены)
  canReport: boolean;
  canAccept: boolean;
  canPay: boolean;
};

/** Серия (регулярный заказ): выходы сдаются, принимаются и рассчитываются по дням. */
export const isSeries = (repeat: string | null | undefined) => !!repeat;
/** «По снегопаду»: дни серии — вызовы работодателя на дату, а не расписание. */
export const isOnCall = (repeat: string | null | undefined) => !!repeat && /снегопад/.test(repeat);
/** Вызовов в одной серии «по снегопаду» — не больше. */
export const MAX_CALLS = 60;

/** Номер спора для людей: «СП-12». */
export const disputeNum = (n: number) => 'СП-' + n;

export function seriesDayLabel(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.getUTCDate() + ' ' + MONTHS_GEN[d.getUTCMonth()] + ', ' + WEEKDAYS[d.getUTCDay()];
}

export const SAFETY_ITEMS = [
  { id: 'brief', label: 'инструктаж прочитан' },
  { id: 'ppe', label: 'СИЗ на месте: перчатки, каска, жилет' }
] as const;

export const AUTO_ACCEPT_DAYS = 7;
export const REVIEW_EDIT_MIN = 10;
export const HIRE_GREETING = 'Здравствуйте! Вы наняты на этот заказ. Подтвердите, пожалуйста, время выхода.';
export const REPORT_MESSAGE = 'Работа выполнена — прошу принять.';
export const LEAVE_REASONS = ['не смогу выйти', 'болезнь', 'нашёл другую смену', 'не договорились по условиям', 'далеко ехать'];
export const COMPLAINT_KINDS = {
  employer: ['работа не выполнена', 'исполнитель не вышел', 'ущерб имуществу', 'грубое общение'],
  freelancer: ['не рассчитались', 'условия не совпали с описанием', 'небезопасный объект', 'грубое общение']
};
export const QUICK_REPLIES = ['Буду через 20 минут', 'Инвентарь свой', 'Подтверждаю выход', 'Готово, отправил фото'];

/** Строка «Мои смены / Мои заказы». */
export type MyJob = JobSummary & {
  reportedAt: string | null;
  acceptedAt: string | null;
  autoAccepted: boolean;
  autoAcceptAt: string | null;
  cancellation: { reason: string; at: string } | null;
  withdrawal: { reason: string; at: string } | null;
  noShow: boolean;
  counterpart: string;               // работодатель (для исполнителя) или нанятые (для работодателя)
  hasChat: boolean;
  chatThread: string | null;         // для исполнителя — свой диалог
  reviewed: number;                  // сколько отзывов я оставил
  reviewable: number;                // сколько могу оставить
  /** Исполнитель: дни серии, на которые он откликался заменой, и решение по каждому. */
  subDays: { day: string; status: 'sent' | 'hired' | 'rejected' }[];
};

export type ChatThread = {
  num: number;
  thread: string;                    // id исполнителя — диалог внутри заказа
  title: string;
  who: string;
  last: string;
  lastMine: boolean;
  lastAt: string | null;
  unread: number;
  jobStatus: JobStatus;
};

export type ChatMessage = { id: string; mine: boolean; text: string; at: string; read: boolean };

/** Поля формы «Новый заказ» (4 шага). */
export type JobForm = {
  lat: number | null;
  lng: number | null;
  address: string;
  district: string;
  type: string;        // id из справочника
  typeOther: string;   // свой тип
  desc: string;
  volume: string;
  crew: string;
  req: string;
  pay: string;
  unit: string;
  payType: string;
  dateISO: string;
  urgent: boolean;
  regular: boolean;
  repeat: string;
  repeatNote: string;
  access: string[];
  tools: string;
  meetName: string;
  meetPhone: string;
  /** Объект работодателя, с которого создан заказ (история смен по адресу). */
  objectId: string;
};

export const emptyJobForm = (): JobForm => ({
  lat: null, lng: null, address: '', district: '', type: '', typeOther: '', desc: '', volume: '', crew: '1', req: '',
  pay: '', unit: 'за заказ', payType: PAY_TYPES[0], dateISO: '', urgent: false, regular: false, repeat: '', repeatNote: '',
  access: [], tools: '', meetName: '', meetPhone: '', objectId: ''
});

export const payNumber = (v: string | number) => parseInt(String(v).replace(/\D/g, ''), 10) || 0;

/** Ошибки шага формы. Ключи — поля формы. */
export function jobStepErrors(step: number, f: JobForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (!f.address.trim()) e.address = 'Укажите адрес — исполнитель должен понимать, куда идти.';
    else if (f.lat == null || f.lng == null) e.address = 'Поставьте метку на карте — кликом по карте или через поиск адреса.';
  } else if (step === 2) {
    if (!f.desc.trim()) e.desc = 'Опишите, что нужно сделать — объём, особенности объекта.';
    if (!f.type.trim() && !f.typeOther.trim()) e.type = 'Впишите тип работы или выберите готовый из списка.';
    const crew = parseInt(f.crew, 10);
    if (!(crew >= 1 && crew <= 12) && crew !== CREW_ANY) e.crew = 'Людей в смене — от 1 до 12.';
  } else if (step === 3) {
    if (!(payNumber(f.pay) > 0)) e.pay = 'Укажите ставку — без неё заказ не смотрят.';
    else if (payNumber(f.pay) > 10_000_000) e.pay = 'Проверьте ставку — слишком большая сумма.';
    if (!f.dateISO.trim()) e.date = 'Выберите дату выхода.';
    if (f.regular && !f.repeat.trim()) e.repeat = 'Заполните график серии — без него заказ не опубликовать.';
  } else if (step === 4) {
    if (!f.access.length) e.access = 'Впишите, как попасть на объект, и нажмите «Добавить» — это первый вопрос исполнителя.';
    if (!f.tools) e.tools = 'Отметьте, чей инвентарь на смене.';
  }
  return e;
}

export const JOB_FIELD_STEP: Record<string, number> = {
  address: 1, desc: 2, type: 2, crew: 2, pay: 3, unit: 3, date: 3, repeat: 3, access: 4, tools: 4
};

export function jobAllErrors(f: JobForm): Record<string, string> {
  return { ...jobStepErrors(1, f), ...jobStepErrors(2, f), ...jobStepErrors(3, f), ...jobStepErrors(4, f) };
}

export function isKnownUnit(u: string) { return UNITS.includes(u); }
export function isKnownPayType(p: string) { return PAY_TYPES.includes(p); }
export function isKnownRepeat(r: string) { return REPEATS.includes(r); }
export function isKnownTools(t: string) { return TOOLS.includes(t); }

// ─── Форматирование ───

const nbsp = (n: number) => n.toLocaleString('ru-RU').replace(/[\s,]/g, ' ');

/** «6 000 ₽», «900 ₽ / час». */
export function money(v: number, unit?: string | null): string {
  const u = (unit || '').trim();
  return nbsp(v) + ' ₽' + (!u || u === 'за заказ' ? '' : ' / ' + u.replace('за ', ''));
}

/** Короткая ставка для метки на карте: «12 тыс ₽», «1 200 ₽/ч». */
export function moneyShort(v: number, unit?: string | null): string {
  const n = v >= 10000 ? Math.round(v / 1000) + ' тыс' : nbsp(v);
  const short: Record<string, string> = { 'за час': 'ч', 'за смену': 'смену', 'за м²': 'м²', 'за день': 'день' };
  const u = (unit || '').trim();
  return n + ' ₽' + (!u || u === 'за заказ' ? '' : '/' + (short[u] || u.replace(/^за\s+/, '')));
}

export function dateLabel(iso: string): string {
  const p = String(iso || '').split('-');
  if (p.length !== 3) return String(iso || '');
  return parseInt(p[2], 10) + ' ' + (MONTHS_GEN[parseInt(p[1], 10) - 1] || '');
}

export function jobNum(n: number): string {
  return String(n).padStart(2, '0');
}

export function localISO(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function daysAhead(iso: string, todayISO = localISO()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(todayISO + 'T00:00:00Z')) / 86400000);
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

export function crewOf(j: { crew: number }) {
  return j.crew >= CREW_ANY ? Infinity : Math.max(1, j.crew);
}

/** Метка статуса заказа (как statusOf в прототипе). */
export function jobStatus(j: Pick<JobSummary, 'status' | 'hired' | 'crew' | 'urgent' | 'myStatus'>, viewerRole: 'freelancer' | 'employer' | null): { label: string; cls: string } {
  const crew = crewOf(j);
  if (j.status === 'cancelled') return { label: 'Смена отменена', cls: 'tag tag-outline' };
  if (j.status === 'accepted') return { label: 'Смена закрыта', cls: 'tag tag-neutral' };
  if (viewerRole === 'freelancer' && j.myStatus === 'hired') return { label: 'Вас наняли', cls: 'tag tag-neutral' };
  if (j.hired >= crew) return { label: crew > 1 ? 'Смена набрана' : 'Исполнитель найден', cls: 'tag tag-neutral' };
  if (j.hired > 0) return { label: 'Набрано ' + j.hired + (crew === Infinity ? '' : ' из ' + crew), cls: 'tag tag-accent' };
  if (viewerRole === 'freelancer' && j.myStatus === 'sent') return { label: 'Вы откликнулись', cls: 'tag tag-accent' };
  if (j.urgent) return { label: 'Срочно', cls: 'tag tag-accent' };
  return { label: 'Открыт', cls: 'tag tag-outline' };
}

/** Автозаголовок: «Уборка снега — Москва, ул. Тверская». */
export function autoTitle(typeLabel: string, address: string): string {
  const head = String(address || '').split(',').map(p => p.trim()).filter(Boolean).slice(-2).join(', ');
  const t = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
  return (t + (head ? ' — ' + head : '')).slice(0, 160);
}
