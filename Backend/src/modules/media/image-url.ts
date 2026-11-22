const CLOUDINARY_DELIVERY_HOST = 'res.cloudinary.com';

export function imageUrlBase(
  explicitBase: string | undefined,
  cloudName: string | undefined,
): string | null {
  const trimmed = explicitBase?.trim();
  const candidate =
    trimmed ||
    (cloudName?.trim()
      ? `https://${CLOUDINARY_DELIVERY_HOST}/${cloudName.trim()}/image/upload/`
      : '');
  if (!candidate) return null;

  const base = parseHttps(candidate);
  if (!base) return null;
  const path = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return `${base.protocol}//${base.host}${path}`;
}

export function isOwnImageUrl(url: string, base: string, folder?: string): boolean {
  const parsed = parseHttps(url);
  if (!parsed) return false;

  const delivery = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  if (!delivery.startsWith(base)) return false;

  const remainder = delivery.slice(base.length);
  if (!remainder) return false;
  return folder === undefined || remainder === folder || remainder.startsWith(`${folder}/`);
}

function parseHttps(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return parsed;
}
