import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Like, MoreThan, Repository } from 'typeorm';
import { Verification } from '../../database/entities/index';

/** What a mailed link is for. Also the prefix of the stored identifier. */
export type VerificationKind = 'register' | 'password-reset';

/**
 * `identifier` is `<purpose>:<subject>` — a user id for a reset link, an address
 * for a registration link (the account does not exist yet then) — and these two
 * functions are the only places that shape is written down. Anyone needing a row
 * by account must build the same string the issuer did: a query that guesses at
 * the separator matches nothing at all, silently, with no error to follow.
 */
export function verificationIdentifier(kind: VerificationKind, subject: string): string {
  return `${kind}:${subject}`;
}

/**
 * A `LIKE` pattern for every link outstanding for one account, whatever it was
 * issued for. Suffix-matching is what makes it complete: listing known purposes
 * instead would leave a new kind behind the moment one is added.
 *
 * A registration link is deliberately outside this pattern: it belongs to an
 * address, not an account, expires on its own within a day, and can only ever
 * create an account or fail — it cannot act as one.
 *
 * Safe as a pattern because a user id (`newId()` in `src/database/schema.ts`) is
 * `c` plus base36 time plus hex, so it can never carry a wildcard of its own.
 */
export function verificationIdentifierForUser(userId: string): string {
  return `%:${userId}`;
}

/**
 * Tokens behind the two links that go out by e-mail.
 *
 * A row is `<purpose>:<subject>` plus the SHA-256 of the token, and both halves
 * earn their place. The purpose stops a registration link being replayed as a
 * password reset; the subject turns a clicked token straight back into whatever
 * it was made for, with no table searched by anything the caller typed.
 *
 * Only the digest is stored, so a token can be checked but never read back. That
 * is why a fresh request replaces the outstanding link instead of adding a second
 * one: there would be no way to mail the same value again.
 */
@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(Verification)
    private readonly verifications: Repository<Verification>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a link for one subject and returns the plain token to mail, with
   * the address it must go to. Any older link for the same purpose is dropped
   * here, so exactly one message in the mailbox is live at a time.
   */
  async issue(
    kind: VerificationKind,
    subject: { key: string; email: string },
    ttlSeconds: number,
  ): Promise<{ token: string; email: string }> {
    const identifier = verificationIdentifier(kind, subject.key);
    const token = randomBytes(32).toString('base64url');

    // One transaction: two separate writes left a window in which the subject
    // had no live link at all — the old digest was gone and the new row was not
    // yet there — and a failure in that window was answered with a mailed link
    // that could never be read back.
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Verification, { identifier });
      // `save` rather than `insert`: the id of a row is made by the entity's own
      // `@BeforeInsert` hook, and only the save path runs entity hooks.
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

  /**
   * Resolves a submitted token to the subject it was made for (a user id, or an
   * address for a registration link), or null when it is unknown, expired, or for
   * a different purpose.
   *
   * The lookup is by digest alone — the caller has nothing else — and a match is
   * deleted on the spot, so a link works once and a second click is answered
   * exactly like a forged one.
   */
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

    // The delete is the check, not a step after it: `identifier` alone would let
    // two clicks that both passed the read each delete the row the other is
    // deleting and both be answered with a subject. Requiring the digest in the
    // `where` means exactly one removes the row and the other, seeing
    // `affected === 0`, is answered like a forged token — which is what "a link
    // works once" must mean when two tabs are open.
    const removed = await this.verifications.delete({ identifier: match.identifier, value });
    if (removed.affected !== 1) return null;
    return match.identifier.slice(kind.length + 1);
  }

  /**
   * Rows past their own `expiresAt`, deleted, and the count of them.
   *
   * `consume` never removes an expired row — it does not even find one — so a link
   * nobody clicked keeps its digest, and the address or account id it names, in
   * the table forever. Same sweep as the sessions one.
   */
  async deleteExpired(): Promise<number> {
    const removed = await this.verifications.delete({ expiresAt: LessThanOrEqual(new Date()) });
    return removed.affected ?? 0;
  }

  /** SHA-256 of 32 random bytes: enough to look up, one-way, and indexable. */
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
