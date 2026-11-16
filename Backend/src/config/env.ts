export type NodeEnv = 'development' | 'production' | 'test';

export interface Env {
  NODE_ENV: NodeEnv;
  PORT: number;
  API_PREFIX: string;
  APP_BASE_URL: string;

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

  CLOUDINARY_BASE_URL?: string;
  CORS_ORIGINS: string;

  THROTTLE_TTL_MS: number;
  THROTTLE_LIMIT: number;

  TRUST_PROXY_HOPS: number;
}

const NODE_ENVIRONMENTS: NodeEnv[] = ['development', 'production', 'test'];

const MIN_SECRET_LENGTH = 32;

function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

function textOr(raw: Record<string, unknown>, key: string, fallback: string): string {
  return text(raw, key) ?? fallback;
}

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

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Every value a boot needs is checked here, and every problem is reported in one throw.
export function loadEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];

  const nodeEnv = text(raw, 'NODE_ENV') ?? '';
  if (!NODE_ENVIRONMENTS.includes(nodeEnv as NodeEnv)) {
    problems.push(`NODE_ENV: required, must be one of ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  const databaseUrl = text(raw, 'DATABASE_URL') ?? '';
  if (!databaseUrl) problems.push('DATABASE_URL: required');

  const jwtSecret = text(raw, 'JWT_SECRET') ?? '';
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET: required, at least ${MIN_SECRET_LENGTH} characters`);
  }

  const port = integer(raw, 'PORT', problems) ?? 3000;
  const smtpPort = integer(raw, 'SMTP_PORT', problems);

  const throttleTtlMs = integer(raw, 'THROTTLE_TTL_MS', problems) ?? 60_000;
  const throttleLimit = integer(raw, 'THROTTLE_LIMIT', problems) ?? 120;

  const trustProxyHops = integer(raw, 'TRUST_PROXY_HOPS', problems) ?? 0;
  if (trustProxyHops < 0) {
    problems.push(`TRUST_PROXY_HOPS: expected 0 or more proxies, got "${trustProxyHops}"`);
  }

  const appBaseUrl = textOr(raw, 'APP_BASE_URL', 'http://localhost:3000');
  if (!isUrl(appBaseUrl)) {
    problems.push(`APP_BASE_URL: expected an http(s) URL, got "${appBaseUrl}"`);
  }

  const frontendUrl = text(raw, 'FRONTEND_URL');
  if (frontendUrl && !isUrl(frontendUrl)) {
    problems.push(`FRONTEND_URL: expected an http(s) URL, got "${frontendUrl}"`);
  }

  const smtpHost = text(raw, 'SMTP_HOST')?.trim() ?? '';
  if (nodeEnv === 'production' && !smtpHost) {
    problems.push(
      'SMTP_HOST: required in production, so reset links are mailed rather than logged',
    );
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
    SMTP_HOST: smtpHost || undefined,
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

export const INSTITUTION = {
  name: 'American International University-Bangladesh',
  shortName: 'AIUB',
  emailDomain: 'student.aiub.edu',
} as const;

export const INSTITUTION_EMAIL_SUFFIX = `@${INSTITUTION.emailDomain}`;

const INSTITUTION_ADDRESS = /^\d{2}-\d{5}-\d@student\.aiub\.edu$/;

export function isInstitutionEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return INSTITUTION_ADDRESS.test(email.trim().toLowerCase());
}
