import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidationIssue } from '../../common/validators/validation-errors';
import { imageUrlBase, isOwnImageUrl } from './image-url';

/**
 * Turns the URL shape in `./image-url` into the answer every other validation
 * failure in this API already gives: `400 VALIDATION_FAILED`, one `details`
 * entry naming the field.
 *
 * That is a deliberate choice over a dedicated code like `IMAGE_URL_NOT_ALLOWED`.
 * A client that highlights `details[].path` — which is what every form against
 * this API does for a mistyped price or a too-short title — needs no new branch
 * for a link it should not have sent, and the route's contract does not change.
 *
 * The check lives here rather than on the DTOs because it needs two things a DTO
 * does not have: the configured base, and the id of the account making the call,
 * which is what says whose Cloudinary folder a listing may read from.
 */
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

  /**
   * Every image a listing points at, each from the caller's own uploads.
   *
   * `MediaService` stores under `<folder>/<userId>/`, so a student who has read
   * somebody else's public URL still cannot attach it to their own listing.
   */
  assertListingImages(urls: readonly string[], ownerId: string): void {
    if (!urls.length) return;
    this.refuse(
      urls.map((url, index) => [url, `imageUrls[${index}]`] as const),
      `${this.folder}/${ownerId}`,
    );
  }

  /** A profile picture: our own delivery URL, with no folder rule to add. */
  assertProfileImage(url: string): void {
    this.refuse([[url, 'image'] as const], undefined);
  }

  /**
   * One pass over the links, one error that lists every offender: a body with
   * two foreign URLs is two findings for whoever reads the response, not two
   * round trips.
   *
   * A process with no Cloudinary base configured refuses every link, because the
   * only route that could have produced a valid one is disabled in the same
   * process — accepting a URL nobody uploaded would be the finding again,
   * dressed up as a working deployment.
   */
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

/** The offending text is worth quoting, but not worth an unbounded error body. */
function shorten(url: string): string {
  return url.length > 120 ? `${url.slice(0, 120)}…` : url;
}
