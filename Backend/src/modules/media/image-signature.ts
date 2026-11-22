export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';

export const IMAGE_MIMES: readonly ImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];

function startsWith(buffer: Buffer, offset: number, expected: number[]): boolean {
  if (buffer.length < offset + expected.length) return false;
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, offset: number, expected: string): boolean {
  return startsWith(
    buffer,
    offset,
    [...expected].map((character) => character.charCodeAt(0)),
  );
}

// The bytes decide the format; a client-declared Content-Type is never trusted.
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
