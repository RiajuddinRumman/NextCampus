import { Injectable } from '@nestjs/common';

/**
 * How much one student may upload in an hour.
 *
 * The per-request ceilings (5 MB per file, 4 files per request, in
 * `media.controller.ts`) and the account throttle (120 requests a minute,
 * `THROTTLE_LIMIT` in `src/config/env.ts`) are all per request, so one campus
 * session could otherwise push over a terabyte an hour into a Cloudinary account
 * that bills by storage and transfer. `@VerifiedStudent()` means every upload
 * already carries an id to count against.
 *
 * The two numbers cap different mistakes: 40 files is ten full requests, enough
 * for a student photographing everything they own, while 200 MB caps the cost
 * when every file is at the per-file maximum. 40 x 5 MB is exactly 200 MB, so
 * the two ceilings meet at the largest hour requests can build and neither is a
 * number nothing can reach.
 */
export const UPLOAD_WINDOW_MS = 60 * 60_000;
export const UPLOAD_HOURLY_FILES = 40;
export const UPLOAD_HOURLY_BYTES = 200 * 1024 * 1024;

/** One request's worth of uploads, as the window remembers it. */
export interface UploadSpend {
  at: number;
  files: number;
  bytes: number;
}

/**
 * The decision, apart from the state it reads: may `files` more images totalling
 * `bytes` go out for a user who already spent `history` in this window? Both
 * ceilings are checked because either can be the binding one, and the request
 * is all-or-nothing either way — `uploadMany` uploads nothing if any file fails,
 * so a request crossing a ceiling is refused whole, never half accepted.
 */
export function mayUpload(
  history: readonly UploadSpend[],
  now: number,
  files: number,
  bytes: number,
): boolean {
  const inWindow = history.filter((spend) => now - spend.at < UPLOAD_WINDOW_MS);
  const spentFiles = inWindow.reduce((total, spend) => total + spend.files, 0);
  const spentBytes = inWindow.reduce((total, spend) => total + spend.bytes, 0);

  return spentFiles + files <= UPLOAD_HOURLY_FILES && spentBytes + bytes <= UPLOAD_HOURLY_BYTES;
}

/**
 * A per-process record of what each account uploaded. In memory for the same
 * reasons `MailCooldown` is: the answer only has to stop one account draining
 * the bucket, and it is a spend limit rather than a billing record. Two
 * instances behind a load balancer each count their own, so an hour can carry
 * slightly more than the ceiling — worth revisiting with a shared store before
 * the media account is paying real money.
 */
@Injectable()
export class UploadQuota {
  private readonly spent = new Map<string, UploadSpend[]>();

  /**
   * Claim the next window slot for `userId` and say whether the upload may go.
   * Taking and answering are one call, as with the mail cooldown: `uploadMany`
   * sends every file in the request or none, so there is no partial spend to
   * hand back when the answer is no.
   */
  take(userId: string, files: number, bytes: number, now = Date.now()): boolean {
    const history = (this.spent.get(userId) ?? []).filter(
      (spend) => now - spend.at < UPLOAD_WINDOW_MS,
    );
    if (!mayUpload(history, now, files, bytes)) {
      this.spent.set(userId, history);
      return false;
    }
    history.push({ at: now, files, bytes });
    this.spent.set(userId, history);
    return true;
  }
}
