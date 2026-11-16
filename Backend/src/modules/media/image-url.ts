/**
 * The one honest question about an image URL: did this platform put it there?
 *
 * Listings and profiles store a URL, not bytes, so text arriving on those
 * routes is what a student's browser will later be told to load. Asking only
 * "is this shaped like a URL" let a caller point a hundred profile pages at
 * their own server — a tracking pixel, a redirect to a phishing page, a
 * non-image in an `<img>` tag. The rule here is a prefix: the delivery URL of
 * the one route that can put an image on disk, `POST /api/media/images`.
 *
 * Two shapes that look safe but are not: another tenant's real Cloudinary host,
 * so the comparison includes the cloud name rather than the hostname alone; and
 * our host tucked into someone else's query string, so every test parses the
 * URL first instead of matching strings.
 */

/** Where Cloudinary serves a public image from when no CDN is configured. */
const CLOUDINARY_DELIVERY_HOST = 'res.cloudinary.com';

/**
 * The prefix every accepted URL must start with, or `null` when this process
 * cannot say: no base configured and no cloud name to build one from.
 * `CLOUDINARY_BASE_URL` wins over the derived form because a deployment behind
 * a CDN really does serve from another host, and the check has to follow that
 * decision rather than reopen it.
 */
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

/**
 * Whether `url` is an https delivery link under `base`, optionally limited to
 * one folder inside it — how a listing asks "yours, not another student's" of a
 * string that names no owner.
 */
export function isOwnImageUrl(url: string, base: string, folder?: string): boolean {
  const parsed = parseHttps(url);
  if (!parsed) return false;

  // Host and path in one string, so `res.cloudinary.com.evil.test` fails the
  // prefix instead of matching the real host with a borrowed path.
  const delivery = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  if (!delivery.startsWith(base)) return false;

  const remainder = delivery.slice(base.length);
  if (!remainder) return false;
  return folder === undefined || remainder === folder || remainder.startsWith(`${folder}/`);
}

/**
 * An https URL with nothing else in it: no credentials, no query, no fragment.
 * A query is how a link that looks like ours becomes somebody else's redirect,
 * and a password in the authority hands a hostname check a string that is not
 * the hostname; Cloudinary needs neither, and a transformation belongs in the
 * path anyway.
 */
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
