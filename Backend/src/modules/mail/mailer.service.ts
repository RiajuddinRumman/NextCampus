import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * How often one mailbox may be written to.
 *
 * The route-level `@Throttle` in `auth.controller.ts` counts requests per IP,
 * which is the wrong unit for this: a shared connection - a campus Wi-Fi
 * address, a dorm NAT - has hundreds of students behind one bucket, while the
 * mailbox being filled belongs to exactly one of them. A caller who rotates
 * through addresses can therefore mail one student as often as they like. This
 * gate is keyed on the address, which is the thing actually being spent.
 */
export const MAIL_COOLDOWN_MS = 60_000;
export const MAIL_HOURLY_LIMIT = 5;

const HOUR_MS = 60 * 60_000;

/**
 * The decision, apart from the state it reads: given the moments the earlier
 * mails for one key went out, may another go now?
 *
 * `sentAt` is expected oldest-first, as `MailCooldown` keeps it.
 */
export function maySendMail(sentAt: readonly number[], now: number): boolean {
  const mostRecent = sentAt[sentAt.length - 1];
  if (mostRecent !== undefined && now - mostRecent < MAIL_COOLDOWN_MS) return false;
  return sentAt.filter((at) => now - at < HOUR_MS).length < MAIL_HOURLY_LIMIT;
}

/**
 * A per-process record of when each mailbox was last written to.
 *
 * Deliberately in memory rather than in the database: the answer only has to be
 * good enough to stop one caller draining one inbox, and the state is worthless
 * after a restart anyway. It does mean an instance behind a load balancer each
 * count their own - the same trade-off the throttler's default storage makes, and
 * the same one to revisit with a shared store if this API ever runs on more than
 * one process.
 *
 * The map is also the only thing in this file that grows with traffic and never
 * on its own, so forgetting is part of the design: see `pruneCooldown()`.
 */
@Injectable()
export class MailCooldown {
  private readonly sentAt = new Map<string, number[]>();

  /** The moment the stale keys were last swept, so the sweep is not per request. */
  private lastSweep = 0;

  /**
   * Claim the next slot for `key` (`<purpose>:<address>`, the same shape a
   * `verifications.identifier` has) and say whether a mail may go out.
   *
   * Taking the slot and answering in one call is the point: a caller that asked
   * first and mailed second would have to undo an issued token whenever the
   * answer was no.
   */
  take(key: string, now = Date.now()): boolean {
    // Once an hour of traffic, not once a request: an entry this sweep drops
    // belongs to an address that is not being written to, so nobody is waiting
    // on the answer for it, and a bot that mints addresses is the only caller
    // who ever makes the map big enough for the walk to cost anything.
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

  /**
   * Handing back the slot a `take()` just claimed, because the mail that slot
   * was for was never delivered.
   *
   * Only for a failed send. A student who is refused a link by the gate and
   * tries again a minute later has spent that minute; a student whose link was
   * swallowed by an SMTP outage spent nothing at all, and the next request from
   * them must not have to wait for a mail that is not coming.
   */
  refund(key: string, now = Date.now()): void {
    const history = (this.sentAt.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    history.pop();
    // A refunded send leaves nothing behind, and "nothing behind" means the key
    // goes too — the empty array under a hundred thousand addresses is exactly
    // the memory this class is asked not to keep.
    if (history.length) {
      this.sentAt.set(key, history);
    } else {
      this.sentAt.delete(key);
    }
  }
}

/**
 * The keys the record may forget: every timestamp in the entry is older than the
 * hour, so the entry can no longer change an answer.
 *
 * `take()` has always filtered the stale timestamps out of the entry it is using,
 * which shrinks nothing — the key stays in the map holding an empty array for as
 * long as the process lives, and an address only needs to be typed into a
 * sign-up form once to earn its place there. Deleting the keys is what makes the
 * map bounded by the addresses being mailed rather than by everyone who ever was.
 */
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

/**
 * The two decisions behind every link that goes out by e-mail.
 *
 * A token is mailed to a person, and a person opens mail in a browser. The API
 * route that consumes the token is `POST`-only, so a link aimed at it answers
 * `404` the moment it is clicked — which is what the links used to be, and why
 * the flow could only be finished from a form somebody built by hand. A link
 * therefore belongs to whatever front end reads `?token=` and posts it back, and
 * this is the one place that says which origin that is.
 *
 * Both functions are pure and take their inputs as arguments rather than reading
 * a `ConfigService`, so the rule that decides where a student lands is testable
 * without a server, a mailbox or a database.
 */

/** Which origin a mailed link points at. */
export function mailLinkBase(env: {
  FRONTEND_URL?: string;
  APP_BASE_URL: string;
  API_PREFIX?: string;
}): string {
  const frontend = env.FRONTEND_URL?.trim();
  if (frontend) return trimSlash(frontend);

  // A deployment that has no front end yet still gets a link it can finish by
  // hand, so the fallback is the API's own base plus its prefix: the path the
  // link names is then the `POST` route that redeems the token rather than a
  // path that exists on neither server.
  const prefix = env.API_PREFIX?.trim().replace(/^\/+|\/+$/g, '');
  const base = trimSlash(env.APP_BASE_URL);
  return prefix ? `${base}/${prefix}` : base;
}

/**
 * `<base>/auth/<route>?token=<token>`.
 *
 * The route names are the front end's page paths and happen to match the API
 * routes that consume them (`complete-registration`, `reset-password`), so a
 * token in a link is recognisable in the log line it ends up in. `token` is
 * percent-encoded, because it is a random string that may contain `-` and `_`.
 */
export function mailedLink(route: string, token: string, base: string): string {
  return `${trimSlash(base)}/auth/${route}?token=${encodeURIComponent(token)}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

/**
 * Best-effort mail delivery. Without SMTP configuration the message is logged
 * instead — local development relies on the logged verification/reset links,
 * and the e2e suite reads its tokens from there.
 */
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

  /**
   * Whether the message left this process.
   *
   * `false` is only ever the SMTP branch, and it is reported rather than thrown
   * because an auth flow must not fail over a hiccup — but the caller has to be
   * able to tell, or a delivery that never happened still spends the address's
   * one mail a minute.
   */
  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      // Verification and reset links are retrievable here during development.
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
      // An auth flow must not fail because SMTP hiccuped.
      process.stderr.write(
        `[mailer] delivery failed to=${message.to}: ${(error as Error).message}\n`,
      );
      return false;
    }
  }
}
