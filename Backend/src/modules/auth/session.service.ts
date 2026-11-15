import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { LessThanOrEqual, Not, Repository } from 'typeorm';
import { Session, User } from '../../database/entities/index';
import type { AccountStatus, Role } from '../../database/schema';
import { Errors } from '../../common/errors';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.constants';

/**
 * The account behind an authenticated request — the whole surface a handler is
 * allowed to see about the caller, which is why `passwordHash` is not in it.
 */
export interface AuthUser {
  id: string;
  /**
   * Row in `sessions` that the presented cookie resolved to. Sign-out and
   * `GET /api/auth/me` need it; everything else can ignore it.
   */
  sessionId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  status: AccountStatus;
}

/** What the signed cookie contains. Nothing else is trusted from the client. */
export interface SessionClaims {
  /** User id. */
  sub: string;
  /** Handle of the `sessions` row this token belongs to. */
  sid: string;
}

export interface IssuedSession {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Sessions: one row in `sessions`, one signed token in an httpOnly cookie.
 *
 * The token proves *who* is calling (its signature can only come from this
 * server); the row decides *whether that identity is still allowed in*. Losing the
 * row — sign-out, suspension, password reset — logs the cookie out without
 * touching the browser, so revocation is instant rather than waiting for the
 * token to expire.
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Creates the row and returns the value that goes into the cookie. */
  async issue(
    userId: string,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<IssuedSession> {
    const saved = await this.sessions.save(
      this.sessions.create({
        // A second random handle, separate from the row id, so a token leak
        // never reveals a primary key that looks guessable in bulk.
        token: randomBytes(32).toString('base64url'),
        expiresAt: this.expiry(),
        ipAddress: meta.ipAddress ?? null,
        userAgent: (meta.userAgent ?? '').slice(0, 300) || null,
        userId,
      }),
    );
    return {
      id: saved.id,
      token: saved.token,
      expiresAt: saved.expiresAt,
      createdAt: saved.createdAt,
    };
  }

  /** Signs the claims; the result is what the browser receives. */
  sign(claims: SessionClaims): Promise<string> {
    return this.jwt.signAsync(claims, { expiresIn: SESSION_TTL_SECONDS });
  }

  /**
   * Turns a request's cookie or bearer header into an authenticated user.
   * Returns undefined when the caller is anonymous, throws when a presented
   * credential is unusable — `SessionGuard` decides which of the two matters.
   */
  async readUser(headers: {
    cookie?: string;
    authorization?: string;
  }): Promise<AuthUser | undefined> {
    const token = this.extractToken(headers);
    if (!token) return undefined;

    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(token);
    } catch {
      throw Errors.invalidSession();
    }
    if (!claims?.sub || !claims?.sid) {
      throw Errors.invalidSession('Invalid session token');
    }

    const stored = await this.sessions.findOne({
      where: { token: claims.sid },
      select: { id: true, expiresAt: true, userId: true },
    });
    if (!stored || stored.expiresAt.getTime() <= Date.now()) throw Errors.invalidSession();

    // Two small reads instead of one join: the columns named here are the whole
    // surface an authenticated request may see, so `passwordHash` cannot slip
    // through by accident.
    const user = await this.users.findOne({ where: { id: stored.userId } });
    if (!user) throw Errors.invalidSession();

    return {
      id: user.id,
      sessionId: stored.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image ?? null,
      role: user.role,
      status: user.status,
    };
  }

  /** Row view used by `GET /api/auth/me`. */
  async describe(id: string) {
    const stored = await this.sessions.findOne({
      where: { id },
      select: { id: true, expiresAt: true, createdAt: true },
    });
    if (!stored) return null;
    return { id: stored.id, expiresAt: stored.expiresAt, createdAt: stored.createdAt };
  }

  async revoke(id: string): Promise<void> {
    await this.sessions.delete({ id });
  }

  /**
   * Used by suspension and password reset: nobody keeps a live cookie. A
   * password change from inside a session passes `keepSessionId` so the tab
   * that made the call stays signed in.
   */
  async revokeAllForUser(userId: string, keepSessionId?: string): Promise<void> {
    await this.sessions.delete(keepSessionId ? { userId, id: Not(keepSessionId) } : { userId });
  }

  /**
   * Rows past their own `expiresAt`, deleted, and the count of them.
   *
   * A request never removes one: an expired session is refused and its row stays,
   * and `AppModule`'s guards cannot reach it either (the cookie that named it is
   * itself refused), so this sweep is the only way those rows leave.
   */
  async deleteExpired(): Promise<number> {
    const removed = await this.sessions.delete({ expiresAt: LessThanOrEqual(new Date()) });
    return removed.affected ?? 0;
  }

  /**
   * Writes the session cookie. `httpOnly` is the important word: page scripts
   * cannot read it, so a cross-site script on the front end cannot steal the
   * credential the way it could steal a token kept in localStorage.
   */
  writeCookie(res: Response, value: string): void {
    res.cookie(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private extractToken(headers: { cookie?: string; authorization?: string }): string | undefined {
    const bearer = headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (bearer) return bearer;
    return this.parseCookie(headers.cookie ?? '')[SESSION_COOKIE];
  }

  /**
   * Minimal Cookie-header reader. Express hands this string over unparsed and
   * the only key we care about is ours, so there is no parser dependency here.
   */
  private parseCookie(header: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 1) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!value) continue;
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
    return cookies;
  }

  private expiry(): Date {
    return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  }
}
