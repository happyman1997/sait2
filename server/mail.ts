// E-mail: SMTP (российский провайдер — Яндекс 360, Mail.ru для бизнеса, UniSender и т. п.) или лог в разработке.
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config';

export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    console.log(`[email] ${to} ← ${subject}\n${text}`);
  }
}

/** Транспорт SMTP с короткими таймаутами: письмо с кодом человек ждёт на экране, а по умолчанию ожидание связи — 2 минуты. */
export function smtpTransport(url: string): Transporter {
  return nodemailer.createTransport({ url, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
}

class SmtpMailer implements Mailer {
  private t: Transporter = smtpTransport(config.smtpUrl());
  async send(to: string, subject: string, text: string) {
    await this.t.sendMail({ from: config.emailFrom(), to, subject, text });
  }
}

/** Причина ошибки отправки для журнала: код и ответ почтового сервера (пароля в них нет). */
export function mailErrorText(e: unknown): string {
  const x = e as { code?: string; responseCode?: number; response?: string; message?: string };
  return [x?.code, x?.responseCode, x?.response || x?.message].filter(v => v != null && v !== '').join(' ').slice(0, 300);
}

let mailer: Mailer | null = null;
export function getMailer(): Mailer {
  if (!mailer) mailer = config.emailProvider() === 'smtp' ? new SmtpMailer() : new ConsoleMailer();
  return mailer;
}

/** Для тестов: подменить отправку. */
export function setMailer(m: Mailer | null) { mailer = m; }
