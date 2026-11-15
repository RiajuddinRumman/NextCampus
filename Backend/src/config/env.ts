/**
 * Environment reading, in one place.
 *
 * `loadEnv` is what Nest's ConfigService is given at start-up, so every value
 * read later through `ConfigService.get(...)` comes out of here. It does three
 * jobs: fill in defaults, convert the numbers (`PORT`, `SMTP_PORT` and the two
 * throttle settings), and refuse to boot when a required setting is missing or
 * malformed — a server that starts with a broken database URL fails much later
 * and much less clearly than one that refuses to start.
 *
 * Optional integrations (SMTP, Cloudinary) are intentionally allowed to be
 * empty. Their services degrade: mail links are logged instead of sent, and
 * uploads answer 503.
 *
 * One thing below is not an environment setting at all: the institution rule, at
 * the foot of the file. It decides who may hold an account, so it moves by commit
 * and review, and reading it here rather than from a variable is the point.
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface Env {
  NODE_ENV: NodeEnv;
  PORT: number;
  API_PREFIX: string;
  APP_BASE_URL: string;
  /**
   * Where the web application the students actually use lives. Mailed links go
   * here, because the thing a link can do is arrive somewhere a person can read:
   * the API route that consumes a token answers `404` to the `GET` a browser
   * makes. Unset, the links fall back to that route — `APP_BASE_URL` plus
   * `API_PREFIX` — so the token is still copyable and the path at least exists,
   * which is the hand-finished flow §5.4 of the README describes.
   */
  FRONTEND_URL?: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_UPLOAD_FOLDER: string;
  /**
   * The exact prefix every image URL this platform accepts must start with.
   * Unset, it is built from `CLOUDINARY_CLOUD_NAME`; set it when a CDN or a
   * private distribution sits in front of Cloudinary, because the URLs the front
   * end receives then name that host instead, and the check in
   * `src/modules/media/image-url.ts` compares whole prefixes rather than hosts
   * so that `res.cloudinary.com/attacker` cannot borrow the real one's shape.
   */
  CLOUDINARY_BASE_URL?: string;
  CORS_ORIGINS: string;
  /** Requests per IP inside `THROTTLE_TTL_MS`, and how long that window is. */
  THROTTLE_TTL_MS: number;
  THROTTLE_LIMIT: number;
  /**
   * How many proxies sit in front of this process, which is what makes
   * `req.ip` - and so every rate limit - the student's address rather than the
   * load balancer's. `0` means nothing is in front, and that is the default
   * because a server that trusts a header nobody meant to forward accepts a
   * spoofed one instead.
   */
  TRUST_PROXY_HOPS: number;
}

const NODE_ENVIRONMENTS: NodeEnv[] = ['development', 'production', 'test'];

/**
 * A 256-bit key is the shortest thing worth signing sessions with, and a
 * secret this length is comfortably guessable, so the check is a floor rather
 * than a preference.
 */
const MIN_SECRET_LENGTH = 32;

/** Reads one variable, treating anything that is not a string as unset. */
function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

/** Reads one variable and keeps its default when the key is absent. */
function textOr(raw: Record<string, unknown>, key: string, fallback: string): string {
  return text(raw, key) ?? fallback;
}

/** Reads a whole-number variable, recording a problem when it is not one. */
function integer(
  raw: Record<string, unknown>,
  key: string,
  problems: string[],
): number | undefined {
  const value = text(raw, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    problems.push(`${key}: expected a whole number, got "${value}"`);
    return undefined;
  }
  return parsed;
}

/** A URL that is present must at least look like one, or links break silently. */
function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function loadEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];

  // Required, no default: several security decisions read this value - whether
  // a boot-time password may be written at all, whether the mailed link is
  // https-only, whether Swagger is served - and a guess about which environment
  // the process is in is not something to fall back to.
  const nodeEnv = text(raw, 'NODE_ENV') ?? '';
  if (!NODE_ENVIRONMENTS.includes(nodeEnv as NodeEnv)) {
    problems.push(`NODE_ENV: required, must be one of ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  // Required, no default: there is no sensible database to fall back to.
  const databaseUrl = text(raw, 'DATABASE_URL') ?? '';
  if (!databaseUrl) problems.push('DATABASE_URL: required');

  // Session cookies are signed with this. Anyone who holds it can mint a
  // session for any account, so a short or shared value is a security bug.
  const jwtSecret = text(raw, 'JWT_SECRET') ?? '';
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET: required, at least ${MIN_SECRET_LENGTH} characters`);
  }

  const port = integer(raw, 'PORT', problems) ?? 3000;
  const smtpPort = integer(raw, 'SMTP_PORT', problems);

  // Checked here rather than passed through `Number(process.env.X)`: a typo like
  // `THROTTLE_LIMIT=abc` would otherwise become `NaN`, and a rate limiter whose
  // limit is `NaN` lets every request through without ever saying so.
  const throttleTtlMs = integer(raw, 'THROTTLE_TTL_MS', problems) ?? 60_000;
  const throttleLimit = integer(raw, 'THROTTLE_LIMIT', problems) ?? 120;

  // A negative hop count is not "no proxy", it is a value `proxyaddr` reads as
  // "trust this many addresses from the right, minus one", which is a rate
  // limiter keyed on the wrong address. `0` is the honest way to say it.
  const trustProxyHops = integer(raw, 'TRUST_PROXY_HOPS', problems) ?? 0;
  if (trustProxyHops < 0) {
    problems.push(`TRUST_PROXY_HOPS: expected 0 or more proxies, got "${trustProxyHops}"`);
  }

  const appBaseUrl = textOr(raw, 'APP_BASE_URL', 'http://localhost:3000');
  if (!isUrl(appBaseUrl)) {
    problems.push(`APP_BASE_URL: expected an http(s) URL, got "${appBaseUrl}"`);
  }

  // Optional, and validated only when present: an empty value means "there is no
  // front end to point at yet", which is true of this repository on its own and
  // is not a mistake to refuse to boot over.
  const frontendUrl = text(raw, 'FRONTEND_URL');
  if (frontendUrl && !isUrl(frontendUrl)) {
    problems.push(`FRONTEND_URL: expected an http(s) URL, got "${frontendUrl}"`);
  }

  if (problems.length) {
    throw new Error(`Invalid environment configuration -> ${problems.join('; ')}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnv,
    PORT: port,
    API_PREFIX: textOr(raw, 'API_PREFIX', 'api'),
    APP_BASE_URL: appBaseUrl,
    FRONTEND_URL: frontendUrl,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    SMTP_HOST: text(raw, 'SMTP_HOST'),
    SMTP_PORT: smtpPort,
    SMTP_USER: text(raw, 'SMTP_USER'),
    SMTP_PASSWORD: text(raw, 'SMTP_PASSWORD'),
    MAIL_FROM: text(raw, 'MAIL_FROM'),
    CLOUDINARY_CLOUD_NAME: text(raw, 'CLOUDINARY_CLOUD_NAME'),
    CLOUDINARY_API_KEY: text(raw, 'CLOUDINARY_API_KEY'),
    CLOUDINARY_API_SECRET: text(raw, 'CLOUDINARY_API_SECRET'),
    CLOUDINARY_UPLOAD_FOLDER: textOr(raw, 'CLOUDINARY_UPLOAD_FOLDER', 'student-platform'),
    CLOUDINARY_BASE_URL: text(raw, 'CLOUDINARY_BASE_URL'),
    CORS_ORIGINS: textOr(raw, 'CORS_ORIGINS', 'http://localhost:5173'),
    THROTTLE_TTL_MS: throttleTtlMs,
    THROTTLE_LIMIT: throttleLimit,
    TRUST_PROXY_HOPS: trustProxyHops,
  };
}

/**
 * The one institution this platform is built for.
 *
 * There was an `approved_domains` table with an admin surface and an
 * `APPROVED_EMAIL_DOMAINS` variable to seed it, which is the shape for a product
 * that signs up many universities. The deployment is AIUB, no second institution
 * is planned, and every row would have carried the same name — so the rule is a
 * checked-in constant here, and adding a domain (staff mail, a new student
 * subdomain) is a commit rather than a runtime edit. With one campus there is
 * also nothing to store per account: the `users.institution` column and the
 * `institution` field in the API responses are gone rather than filled with a
 * repeated string.
 */
export const INSTITUTION = {
  name: 'American International University-Bangladesh',
  shortName: 'AIUB',
  /**
   * Student mailboxes are `<roll>-<batch>@student.aiub.edu`. `@aiub.edu` alone is
   * not accepted: it also exists for staff, and a staff mailbox must not be able
   * to create a student account.
   */
  emailDomain: 'student.aiub.edu',
} as const;

/** The domain an institutional address has to end in, as it appears in a message. */
export const INSTITUTION_EMAIL_SUFFIX = `@${INSTITUTION.emailDomain}`;

/**
 * The whole address rule, and the anchoring is the security property: matching
 * the shape AIUB actually issues — roll, batch, student domain, nothing after it
 * — refuses quotes, a second `@`, a `+tag`, a subdomain above ours and a
 * look-alike suffix without keeping a list of tricks up to date.
 *
 * Written against `INSTITUTION.emailDomain` on purpose, so a review of either
 * half shows the whole rule; changing the domain means changing this pattern.
 */
const INSTITUTION_ADDRESS = /^\d{2}-\d{5}-\d@student\.aiub\.edu$/;

/** Whether this address is one of ours, after the trim and case the column stores. */
export function isInstitutionEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return INSTITUTION_ADDRESS.test(email.trim().toLowerCase());
}
