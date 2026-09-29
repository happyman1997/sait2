import crypto from 'node:crypto';
import { config } from './config';
import { AppError } from './errors';

export type Channel = 'sms' | 'call';

// Отправка кода. Возвращает код, который нужно ввести:
//  - sms: код генерируем мы и отправляем текстом;
//  - call: звонок-сброс, код — последние 4 цифры входящего номера (его сообщает провайдер).
export type Purpose = 'signup' | 'recover' | 'phone';

export interface CodeSender {
  send(phone: string, channel: Channel, purpose: Purpose, ip?: string): Promise<{ code: string }>;
  /** Обычное SMS-уведомление (не код). */
  sendText(phone: string, text: string): Promise<void>;
}

export function randomCode(): string {
  const fixed = config.devFixedCode();
  if (fixed) return fixed;
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

const TEXT: Record<Purpose, (c: string) => string> = {
  signup: (c: string) => `Арена Работы: код ${c}. Никому его не сообщайте.`,
  phone: (c: string) => `Арена Работы: код для смены номера ${c}. Никому его не сообщайте.`,
  recover: (c: string) => `Арена Работы: код для восстановления пароля ${c}. Если это не вы — проигнорируйте.`
};

// Разработка: код печатается в лог сервера.
class ConsoleSender implements CodeSender {
  async send(phone: string, channel: Channel, purpose: Purpose) {
    const code = randomCode();
    console.log(`[sms:${channel}] ${phone} ← ${channel === 'sms' ? TEXT[purpose](code) : 'звонок, код ' + code}`);
    return { code };
  }
  async sendText(phone: string, text: string) {
    console.log(`[sms] ${phone} ← ${text}`);
  }
}

// SMS.ru: sms/send и code/call. Хранение ПДн — на стороне провайдера РФ.
class SmsRuSender implements CodeSender {
  async sendText(phone: string, text: string) {
    await this.sms(phone.replace(/\D/g, ''), text);
  }
  private async sms(to: string, msg: string) {
    const body = new URLSearchParams({ api_id: config.smsRuApiId(), to, msg, json: '1' });
    const r = await fetch('https://sms.ru/sms/send', { method: 'POST', body });
    const j = (await r.json().catch(() => null)) as { status?: string; sms?: Record<string, { status?: string }> } | null;
    const one = j?.sms?.[to];
    if (!j || j.status !== 'OK' || (one && one.status !== 'OK')) throw new AppError(502, 'SMS не отправилось — проверьте номер или повторите через минуту.');
  }
  async send(phone: string, channel: Channel, purpose: Purpose, ip?: string) {
    const apiId = config.smsRuApiId();
    const to = phone.replace(/\D/g, '');
    if (channel === 'call') {
      const u = new URL('https://sms.ru/code/call');
      u.searchParams.set('api_id', apiId);
      u.searchParams.set('phone', to);
      if (ip) u.searchParams.set('ip', ip);
      const r = await fetch(u, { method: 'POST' });
      const j = (await r.json().catch(() => null)) as { status?: string; code?: string | number } | null;
      if (!j || j.status !== 'OK' || !j.code) throw new AppError(502, 'Не получилось позвонить — попробуйте SMS или повторите через минуту.');
      return { code: String(j.code).slice(-4) };
    }
    const code = randomCode();
    await this.sms(to, TEXT[purpose](code));
    return { code };
  }
}

let sender: CodeSender | null = null;
export function codeSender(): CodeSender {
  if (!sender) sender = config.smsProvider() === 'smsru' ? new SmsRuSender() : new ConsoleSender();
  return sender;
}

/** Для тестов: подменить провайдера. */
export function setCodeSender(s: CodeSender | null) {
  sender = s;
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
