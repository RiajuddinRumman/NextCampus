import { Injectable } from '@nestjs/common';

export const UPLOAD_WINDOW_MS = 60 * 60_000;
export const UPLOAD_HOURLY_FILES = 40;
export const UPLOAD_HOURLY_BYTES = 200 * 1024 * 1024;

export interface UploadSpend {
  at: number;
  files: number;
  bytes: number;
}

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

// Counted in this process's memory, so it caps one instance and resets on restart.
@Injectable()
export class UploadQuota {
  private readonly spent = new Map<string, UploadSpend[]>();

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
