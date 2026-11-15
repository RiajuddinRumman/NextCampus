import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Values authentication fixes in code: lifetimes, the cookie name, the signing
 * algorithm, the per-route ceilings, and scrypt.
 *
 * A session lives in two spots at once — the signed token in the cookie and a row
 * in `sessions` — and both carry this lifetime. The row is what makes revocation
 * instant: delete it and the cookie stops working even though the token is still
 * cryptographically valid.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** httpOnly cookie that carries the session token. */
export const SESSION_COOKIE = 'scsp.session';

/**
 * Naming this in `signOptions` only says what this server writes. `verify` with no
 * `algorithms` accepts everything jsonwebtoken knows, so a token signed HS512 with
 * the same secret would read as a session this server issued.
 */
export const JWT_ALGORITHM = 'HS256';

/** Refuses a token from another application that shares this secret by accident. */
export const JWT_ISSUER = 'student-community-platform';

/**
 * Registration gets a day because the student may be away from their mailbox when
 * the link arrives; a reset is worth an hour, because whoever asked is at the form.
 */
export const REGISTRATION_TTL_SECONDS = 60 * 60 * 24;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** A day, because the shortest lifetime any swept row has is an hour, and the sweep runs at start-up too. */
export const EXPIRED_ROW_SWEEP_MS = 60 * 60 * 24 * 1000;

/**
 * Per-route limits, tighter than the application-wide baseline in `app.module.ts`:
 * these are the routes that either guess a password or spend somebody's mailbox.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Trying a password: five a minute per address, then refused for the minute. */
export const SIGN_IN_THROTTLE = { limit: 5, ttl: MINUTE };

/** Mailing a link: five an hour — an hour because the thing being spent is an inbox. */
export const MAIL_THROTTLE = { limit: 5, ttl: HOUR };

/** Spending a mailed token, looser than `MAIL_THROTTLE`: only the recipient can use one. */
export const TOKEN_THROTTLE = { limit: 10, ttl: HOUR };

/**
 * A stored credential is `<16 random bytes as hex>:<64 key bytes as hex>`, from
 * `scrypt`, which costs both time and memory — that is what makes guessing an
 * exported password list expensive. The salt sits beside the hash because
 * verifying needs it, and it is per password, so two students who chose the same
 * word share nothing in a leaked table.
 *
 * The parameters are written down because a hash is only verifiable with the exact
 * settings that produced it, and these must keep matching accounts hashed before
 * this file existed.
 */
const SCRYPT = { N: 16384, r: 16, p: 1, keyLen: 64, maxMem: 128 * 16384 * 16 * 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt)).toString('hex')}`;
}

/**
 * False whenever the stored value is missing or malformed, so an account without
 * a password simply cannot sign in with one.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const candidate = await derive(password, salt);
  const expected = Buffer.from(key, 'hex');
  // Comparison that does not stop at the first difference, so the time an
  // attempt takes does not leak how much of the hash was already right.
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * A Promise wrapper rather than `promisify(scrypt)`, because the typed overload
 * that takes options does not survive promisification.
 */
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC normalisation makes visually identical passwords hash identically.
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keyLen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxMem },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
