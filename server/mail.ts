// E-mail: SMTP (российский провайдер — Яндекс 360, Mail.ru для бизнеса, UniSender и т. п.) или лог в разработке.
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config';

export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    console.log(`[email] ${to} ← ${subject}\n${text}`);
  }
}

class SmtpMailer implements Mailer {
  private t: Transporter = nodemailer.createTransport(config.smtpUrl());
  async send(to: string, subject: string, text: string) {
    await this.t.sendMail({ from: config.emailFrom(), to, subject, text });
  }
}

let mailer: Mailer | null = null;
export function getMailer(): Mailer {
  if (!mailer) mailer = config.emailProvider() === 'smtp' ? new SmtpMailer() : new ConsoleMailer();
  return mailer;
}

/** Для тестов: подменить отправку. */
export function setMailer(m: Mailer | null) { mailer = m; }
