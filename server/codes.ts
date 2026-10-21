// Одноразовые коды подтверждения — приходят письмом (регистрация, восстановление пароля, смена почты).
// В базе — только HMAC кода, сравнение — за постоянное время.
import crypto from 'node:crypto';
import { config } from './config';
import { AppError } from './errors';
import { getMailer, mailErrorText } from './mail';

export const CODE_LEN = 6;
export type CodePurpose = 'signup' | 'recover' | 'email';

export function randomCode(): string {
  const fixed = config.devFixedCode();
  if (fixed) return fixed;
  return String(crypto.randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
}

export function hashCode(challengeId: string, code: string): string {
  return crypto.createHmac('sha256', config.codeSecret()).update(challengeId + ':' + code).digest('hex');
}

export function codeMatches(challengeId: string, code: string, stored: string | null): boolean {
  if (!stored) return false;
  const a = Buffer.from(hashCode(challengeId, code), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const LETTER: Record<CodePurpose, { subject: string; why: string }> = {
  signup: { subject: 'код подтверждения', why: 'Вы регистрируетесь на «Арене Работ».' },
  recover: { subject: 'код для восстановления пароля', why: 'Кто-то (надеемся, вы) восстанавливает пароль от аккаунта на «Арене Работ».' },
  email: { subject: 'код для смены почты', why: 'В аккаунте на «Арене Работ» меняют адрес почты на этот.' }
};

/** Письмо с кодом — сразу, не через очередь уведомлений: человек ждёт его на экране. */
export async function sendCodeEmail(to: string, purpose: CodePurpose, code: string, ttlMin: number) {
  const l = LETTER[purpose];
  try {
    await getMailer().send(to, 'Арена Работ: ' + l.subject + ' ' + code,
      l.why + '\n\nКод: ' + code + '\n\nДействует ' + ttlMin + ' минут. Никому его не сообщайте — сотрудники площадки код не спрашивают.\n' +
      'Если это были не вы, просто удалите письмо.');
  } catch (e) {
    // Адрес получателя сами в журнал не добавляем. Разобрать причину по шагам — bash deploy/mailcheck.sh.
    console.error(`[email] письмо с кодом (${purpose}) не отправлено: ${mailErrorText(e)}`);
    throw new AppError(502, 'Письмо не отправилось — проверьте адрес или повторите через минуту.');
  }
}
