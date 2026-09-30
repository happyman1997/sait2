// Шаблон договора ГПХ (подряд на разовые работы). Площадка — не сторона договора; стороны заполняют и подписывают сами.
import { money } from '@/lib/jobs';
import { one } from './db';
import type { SessionUser } from './session';

const BLANK = '____________________';

type JobRow = {
  num: string; title: string; address: string; date: string; pay: number; unit: string; volume: string | null; pay_type: string | null;
  employer: string; org: string | null; inn: string | null; repeat: string | null; sub_days: string | null;
};

/** Если указан заказ и зритель — его участник, подставляем условия заказа. */
export async function contractTemplate(num: number | null, viewer: Pick<SessionUser, 'id' | 'name' | 'role'> | null) {
  let j: JobRow | null = null;
  let worker: string | null = null;
  if (num && viewer) {
    j = await one<JobRow>(
      `SELECT j.num, j.title, j.address, to_char(j.date, 'DD.MM.YYYY') AS date, j.pay, j.unit, j.volume, j.pay_type, j.repeat,
              e.name AS employer, ep.org_name AS org, ep.inn,
              (SELECT string_agg(to_char(s.day, 'DD.MM.YYYY'), ', ' ORDER BY s.day) FROM series_subs s
                WHERE s.job_id = j.id AND s.freelancer_id = $2 AND s.status = 'hired') AS sub_days
         FROM jobs j JOIN users e ON e.id = j.employer_id LEFT JOIN employer_profiles ep ON ep.user_id = e.id
        WHERE j.num = $1 AND (j.employer_id = $2 OR EXISTS (SELECT 1 FROM hires h WHERE h.job_id = j.id AND h.freelancer_id = $2)
              OR EXISTS (SELECT 1 FROM series_subs s WHERE s.job_id = j.id AND s.freelancer_id = $2 AND s.status = 'hired'))`,
      [num, viewer.id]);
    if (j && viewer.role === 'freelancer') worker = viewer.name;
  }
  const customer = j ? (j.org || j.employer) + (j.inn ? ', ИНН ' + j.inn : '') : BLANK;
  const text = [
    'ДОГОВОР ПОДРЯДА № ' + (j ? 'С-' + j.num : '____') + ' (гражданско-правового характера)',
    '',
    'г. ' + BLANK + '                                   «___» ____________ 20__ г.',
    '',
    'Заказчик: ' + customer + ',',
    'Исполнитель: ' + (worker || BLANK) + ', паспорт ' + BLANK + ',',
    'далее вместе — Стороны, заключили настоящий договор о нижеследующем.',
    '',
    '1. ПРЕДМЕТ ДОГОВОРА',
    '1.1. Исполнитель обязуется выполнить работы: ' + (j ? j.title : BLANK) + (j?.volume ? ', объём — ' + j.volume : '') + ',',
    '     а Заказчик — принять и оплатить их.',
    '1.2. Место выполнения работ: ' + (j ? j.address : BLANK) + '.',
    // Серия — по графику; замена на отдельные дни — только её дни.
    '1.3. Срок выполнения: ' + (!j ? BLANK : j.sub_days && worker ? j.sub_days : j.repeat ? 'по графику «' + j.repeat + '», начиная с ' + j.date : j.date) + '.',
    '1.4. Работы выполняются иждивением ' + BLANK + ' (инструмент и материалы — чьи).',
    '',
    '2. ЦЕНА И ПОРЯДОК РАСЧЁТОВ',
    '2.1. Вознаграждение Исполнителя: ' + (j ? money(j.pay, j.unit) : BLANK) + '.',
    '2.2. Способ оплаты: ' + (j?.pay_type || BLANK) + '. Оплата — не позднее ___ дней после приёмки работ.',
    '2.3. Если Исполнитель применяет режим «Налог на профессиональный доход», он передаёт Заказчику чек.',
    '     Если Исполнитель — физическое лицо без статуса самозанятого, Заказчик-организация исполняет обязанности налогового агента.',
    '',
    '3. ПРИЁМКА РАБОТ',
    '3.1. Заказчик принимает работы в течение ___ дней после сообщения Исполнителя о готовности.',
    '3.2. Результат фиксируется фото до и после работ. Претензии к качеству заявляются при приёмке.',
    '',
    '4. ОТВЕТСТВЕННОСТЬ',
    '4.1. Стороны несут ответственность в соответствии с законодательством РФ.',
    '4.2. Работы на высоте, с кровлей и электроинструментом выполняются с соблюдением правил безопасности;',
    '     средства защиты предоставляет ' + BLANK + '.',
    '',
    '5. ПРОЧИЕ УСЛОВИЯ',
    '5.1. Договор не является трудовым: Исполнитель сам определяет способ выполнения работ.',
    '5.2. Споры решаются переговорами, при недостижении согласия — в суде по месту нахождения ответчика.',
    '',
    'ПОДПИСИ СТОРОН',
    '',
    'Заказчик: ______________ / ' + (j ? j.employer : BLANK) + ' /',
    'Исполнитель: ______________ / ' + (worker || BLANK) + ' /',
    '',
    '—',
    'Шаблон предоставлен площадкой «Арена Работы» для удобства. Платформа не оказывает юридических услуг,',
    'не является стороной договора и не проверяет его. Перед подписанием проверьте условия самостоятельно.'
  ].join('\r\n');
  return { text, filename: j ? 'dogovor-gph-S-' + j.num + '.txt' : 'dogovor-gph.txt' };
}
