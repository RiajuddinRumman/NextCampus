import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const SESSION_COOKIE = 'scsp.session';

export const JWT_ALGORITHM = 'HS256';

export const JWT_ISSUER = 'student-community-platform';

export const REGISTRATION_TTL_SECONDS = 60 * 60 * 24;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

export const EXPIRED_ROW_SWEEP_MS = 60 * 60 * 24 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SIGN_IN_THROTTLE = { limit: 5, ttl: MINUTE };

export const MAIL_THROTTLE = { limit: 5, ttl: HOUR };

export const TOKEN_THROTTLE = { limit: 10, ttl: HOUR };

// These numbers are part of every stored hash: changing one makes existing passwords unverifiable.
const SCRYPT = { N: 16384, r: 16, p: 1, keyLen: 64, maxMem: 128 * 16384 * 16 * 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const candidate = await derive(password, salt);
  const expected = Buffer.from(key, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keyLen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxMem },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
