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

export interface AuthUser {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  status: AccountStatus;
}

export interface SessionClaims {
  sub: string;
  sid: string;
}

export interface IssuedSession {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

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

  async issue(
    userId: string,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<IssuedSession> {
    const saved = await this.sessions.save(
      this.sessions.create({
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

  sign(claims: SessionClaims): Promise<string> {
    return this.jwt.signAsync(claims, { expiresIn: SESSION_TTL_SECONDS });
  }

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

  async revokeAllForUser(userId: string, keepSessionId?: string): Promise<void> {
    await this.sessions.delete(keepSessionId ? { userId, id: Not(keepSessionId) } : { userId });
  }

  async deleteExpired(): Promise<number> {
    const removed = await this.sessions.delete({ expiresAt: LessThanOrEqual(new Date()) });
    return removed.affected ?? 0;
  }

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
