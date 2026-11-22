import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Like, MoreThan, Repository } from 'typeorm';
import { Verification } from '../../database/entities/index';

export type VerificationKind = 'register' | 'password-reset';

export function verificationIdentifier(kind: VerificationKind, subject: string): string {
  return `${kind}:${subject}`;
}

export function verificationIdentifierForUser(userId: string): string {
  return `%:${userId}`;
}

@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(Verification)
    private readonly verifications: Repository<Verification>,
    private readonly dataSource: DataSource,
  ) {}

  async issue(
    kind: VerificationKind,
    subject: { key: string; email: string },
    ttlSeconds: number,
  ): Promise<{ token: string; email: string }> {
    const identifier = verificationIdentifier(kind, subject.key);
    const token = randomBytes(32).toString('base64url');

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Verification, { identifier });
      await manager.save(
        manager.create(Verification, {
          identifier,
          value: this.digest(token),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        }),
      );
    });
    return { token, email: subject.email };
  }

  async consume(kind: VerificationKind, token: string): Promise<string | null> {
    const value = this.digest(token);
    const match = await this.verifications.findOne({
      where: {
        identifier: Like(verificationIdentifier(kind, '%')),
        value,
        expiresAt: MoreThan(new Date()),
      },
      select: { identifier: true },
    });
    if (!match) return null;

    const removed = await this.verifications.delete({ identifier: match.identifier, value });
    if (removed.affected !== 1) return null;
    return match.identifier.slice(kind.length + 1);
  }

  async deleteExpired(): Promise<number> {
    const removed = await this.verifications.delete({ expiresAt: LessThanOrEqual(new Date()) });
    return removed.affected ?? 0;
  }

  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
