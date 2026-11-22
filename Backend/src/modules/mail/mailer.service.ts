import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const MAIL_COOLDOWN_MS = 60_000;
export const MAIL_HOURLY_LIMIT = 5;

const HOUR_MS = 60 * 60_000;

export function maySendMail(sentAt: readonly number[], now: number): boolean {
  const mostRecent = sentAt[sentAt.length - 1];
  if (mostRecent !== undefined && now - mostRecent < MAIL_COOLDOWN_MS) return false;
  return sentAt.filter((at) => now - at < HOUR_MS).length < MAIL_HOURLY_LIMIT;
}

@Injectable()
export class MailCooldown {
  private readonly sentAt = new Map<string, number[]>();

  private lastSweep = 0;

  take(key: string, now = Date.now()): boolean {
    if (now - this.lastSweep >= HOUR_MS) {
      this.lastSweep = now;
      pruneCooldown(this.sentAt, now);
    }
    const history = (this.sentAt.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    if (!maySendMail(history, now)) {
      this.sentAt.set(key, history);
      return false;
    }
    history.push(now);
    this.sentAt.set(key, history);
    return true;
  }

  refund(key: string, now = Date.now()): void {
    const history = (this.sentAt.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    history.pop();
    if (history.length) {
      this.sentAt.set(key, history);
    } else {
      this.sentAt.delete(key);
    }
  }
}

export function pruneCooldown(sentAt: Map<string, number[]>, now: number): void {
  for (const [key, history] of sentAt) {
    const fresh = history.filter((at) => now - at < HOUR_MS);
    if (fresh.length) {
      sentAt.set(key, fresh);
    } else {
      sentAt.delete(key);
    }
  }
}

// A mailed link targets the front end when one is configured; without FRONTEND_URL it falls back to the backend route, which a browser cannot click.
export function mailLinkBase(env: {
  FRONTEND_URL?: string;
  APP_BASE_URL: string;
  API_PREFIX?: string;
}): string {
  const frontend = env.FRONTEND_URL?.trim();
  if (frontend) return trimSlash(frontend);

  const prefix = env.API_PREFIX?.trim().replace(/^\/+|\/+$/g, '');
  const base = trimSlash(env.APP_BASE_URL);
  return prefix ? `${base}/${prefix}` : base;
}

export function mailedLink(route: string, token: string, base: string): string {
  return `${trimSlash(base)}/auth/${route}?token=${encodeURIComponent(token)}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

@Injectable()
export class MailerService {
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const port = this.config.get<number>('SMTP_PORT', 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASSWORD'),
        },
      });
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      process.stdout.write(
        `[mailer:dev] to=${message.to} subject=${message.subject}\n${message.text}\n`,
      );
      return true;
    }
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM'),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return true;
    } catch (error) {
      process.stderr.write(
        `[mailer] delivery failed to=${message.to}: ${(error as Error).message}\n`,
      );
      return false;
    }
  }
}
