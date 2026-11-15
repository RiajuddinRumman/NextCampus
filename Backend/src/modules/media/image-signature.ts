/**
 * What a pile of bytes actually is.
 *
 * `file.mimetype` is multer's reading of the `Content-Type` line inside the
 * multipart body, which is text the sender writes, so it cannot be evidence of a
 * format. Every real image format opens with a fixed header, so the bytes answer
 * the question instead — what the upload route believed before is `CHANGELOG.md`
 * → "New refusals, same response shape".
 *
 * The five formats are the ones `MediaService` accepts and no others: a text file
 * is not detected, an Adobe Illustrator document is not detected, and
 * `detectImageMime` returning `null` means "refuse", not "unknown, let it
 * through".
 *
 * This is a format check, not a safety scan — it says the payload is a JPEG, not
 * that the JPEG is benign. Image decoders still have bugs, which is why the file
 * is re-encoded on the way in (`transformation` in `uploadOne`) rather than served
 * back as stored.
 */

/** The formats an upload may be, decided from the bytes rather than the header. */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';

export const IMAGE_MIMES: readonly ImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];

/** Bytes at an offset, compared against a literal. */
function startsWith(buffer: Buffer, offset: number, expected: number[]): boolean {
  if (buffer.length < offset + expected.length) return false;
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

/** Four ASCII characters, the way ISO-BMIF (AVIF) and RIFF (WebP) name themselves. */
function ascii(buffer: Buffer, offset: number, expected: string): boolean {
  return startsWith(
    buffer,
    offset,
    [...expected].map((character) => character.charCodeAt(0)),
  );
}

/**
 * The declared type of `buffer`, or `null` when it is not one of the five.
 *
 * AVIF is the only format whose identity is not its first four bytes: the box
 * length comes first and `ftyp` follows, so the brand is read at offset 8 and
 * checked against the four that mean "this is an AVIF image". A brand of `heic`
 * is deliberately absent — Apple's container is not in the accepted list, and
 * Cloudinary charges the same storage for a file this API cannot display.
 */
export function detectImageMime(buffer: Buffer): ImageMime | null {
  if (!buffer?.length) return null;

  if (startsWith(buffer, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buffer, 0, 'GIF87a') || ascii(buffer, 0, 'GIF89a')) return 'image/gif';
  if (ascii(buffer, 0, 'RIFF') && ascii(buffer, 8, 'WEBP')) return 'image/webp';
  if (ascii(buffer, 4, 'ftyp')) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (['avif', 'avis', 'mif1', 'msf1'].includes(brand)) return 'image/avif';
  }

  return null;
}
