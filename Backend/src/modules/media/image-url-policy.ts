import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidationIssue } from '../../common/validators/validation-errors';
import { imageUrlBase, isOwnImageUrl } from './image-url';

@Injectable()
export class ImageUrlPolicy {
  private readonly base: string | null;
  private readonly folder: string;

  constructor(config: ConfigService) {
    this.base = imageUrlBase(
      config.get<string>('CLOUDINARY_BASE_URL'),
      config.get<string>('CLOUDINARY_CLOUD_NAME'),
    );
    this.folder = config.get<string>('CLOUDINARY_UPLOAD_FOLDER', 'student-platform');
  }

  // An image belongs to this request only if the host is the configured CDN base and the path sits inside the uploader's own folder.
  assertListingImages(urls: readonly string[], ownerId: string): void {
    if (!urls.length) return;
    this.refuse(
      urls.map((url, index) => [url, `imageUrls[${index}]`] as const),
      `${this.folder}/${ownerId}`,
    );
  }

  assertProfileImage(url: string): void {
    this.refuse([[url, 'image'] as const], undefined);
  }

  private refuse(
    entries: readonly (readonly [string, string])[],
    uploaderFolder: string | undefined,
  ): void {
    const base = this.base;
    if (!base) {
      throw this.invalid(
        entries.map(([, path]): ValidationIssue => ({
          path,
          message: 'No image host is configured, so no image link can be accepted',
        })),
      );
    }

    const details = entries
      .filter(([url]) => !isOwnImageUrl(url, base, uploaderFolder))
      .map(([url, path]): ValidationIssue => ({
        path,
        message:
          uploaderFolder && isOwnImageUrl(url, base)
            ? `${shorten(url)} is another student's upload; link an image you uploaded`
            : `${shorten(url)} is not an image uploaded through this platform`,
      }));

    if (details.length) throw this.invalid(details);
  }

  private invalid(details: ValidationIssue[]): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request body',
      details,
    });
  }
}

function shorten(url: string): string {
  return url.length > 120 ? `${url.slice(0, 120)}…` : url;
}
