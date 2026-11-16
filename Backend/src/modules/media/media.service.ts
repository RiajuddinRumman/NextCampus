import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { detectImageMime, IMAGE_MIMES } from './image-signature';
import { UploadQuota } from './upload-quota';

/**
 * The two ceilings an upload is held to. `media.controller.ts` passes both to
 * multer, which refuses a bad body before any handler runs; `assertValid` below
 * checks the size again because the service is also reachable from a test, a
 * script, or a later route with no interceptor.
 *
 * Four files is the number that matters for memory: the body is buffered in RAM
 * (`memoryStorage`) and handed to Cloudinary from there, so the worst case one
 * request makes is `MAX_FILES * MAX_BYTES`. Cloudinary resizes to 1600 px anyway,
 * so a phone camera's original is not worth five megabytes.
 */
export const MAX_FILES = 4;
export const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Cloudinary, wrapped so that the rest of the app never imports the SDK.
 *
 * 1. **Switched off is a supported state.** `configured` is decided once, in the
 *    constructor, from the three `CLOUDINARY_*` values. With any missing, every
 *    upload answers `503 MEDIA_DISABLED` and the process still boots — which is
 *    also why nothing reaches the network until the per-file checks and the
 *    account's quota have both passed.
 * 2. **`uploadMany` is all-or-nothing per request, not transactional.** Checks
 *    run before any byte is sent and the quota is spent only after they all pass,
 *    but a failure on the fifth file leaves the first four stored and orphaned —
 *    harmless, because nothing references them until a listing posts with the
 *    URLs the client was given.
 * 3. **`moderation: 'blind'` asks for Cloudinary's review; the verdict is never
 *    read back,** so images appear at once. The parameter stays because dropping
 *    it would silently disable a check somebody pays for.
 *
 * Nothing here deletes a file. `ListingsService.update()` replaces the
 * `listing_images` rows and the file stays downloadable by anyone who ever saw
 * its URL; deleting a listing does the same to all of them. A known gap —
 * storage cost and stale content, not a session-secret leak.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger('Media');
  private readonly configured: boolean;
  private readonly folder: string;

  constructor(
    config: ConfigService,
    private readonly uploads: UploadQuota,
  ) {
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');
    this.configured = Boolean(cloudName && apiKey && apiSecret);
    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    } else {
      this.logger.warn('Cloudinary not configured — uploads are disabled in this process');
    }
    this.folder = config.get<string>('CLOUDINARY_UPLOAD_FOLDER', 'student-platform');
  }

  private async uploadOne(file: Express.Multer.File, folder: string): Promise<UploadResult> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
          moderation: 'blind',
        },
        (error, uploaded) => {
          if (!error) {
            // The SDK types both callback arguments as optional, so the answer
            // has to be checked before it is used. Without this the upload
            // would resolve to `undefined` and the failure would surface three
            // lines later as a crash on `undefined.secure_url`.
            if (!uploaded) {
              return reject(new Error('Cloudinary upload failed: no response from the service'));
            }
            return resolve(uploaded);
          }
          // Cloudinary reports a failure as `{ error: { message, http_code } }`
          // — a plain object, not an `Error`. Rejecting with it would hand the
          // caller a reason with no `.message` or stack, so the real text is
          // unwrapped here and put into an Error the logs can print.
          const detail =
            typeof error === 'string'
              ? error
              : ((error as { error?: { message?: string } }).error?.message ?? 'unknown error');
          return reject(new Error(`Cloudinary upload failed: ${detail}`));
        },
      );
      upload.end(file.buffer);
    });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  }

  async uploadMany(
    files: Express.Multer.File[],
    ownerId: string,
  ): Promise<{ images: UploadResult[] }> {
    if (!this.configured) {
      throw new HttpException(
        { code: 'MEDIA_DISABLED', message: 'Media storage is not configured' },
        503,
      );
    }
    files.forEach((file) => this.assertValid(file));

    // Spend is counted here rather than in the controller because a request that
    // fails a check above must not pay for it, and because the number being
    // capped — bytes this account pushed into the bucket — is only known once
    // every file in the request is real.
    const bytes = files.reduce((total, file) => total + file.buffer.length, 0);
    if (!this.uploads.take(ownerId, files.length, bytes)) {
      throw new ThrottlerException('Upload limit reached for this account');
    }

    const images = await Promise.all(
      files.map((file) => this.uploadOne(file, `${this.folder}/${ownerId}`)),
    );
    return { images };
  }

  private assertValid(file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'EMPTY_UPLOAD', message: 'Upload contains no bytes' });
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException({
        code: 'UPLOAD_TOO_LARGE',
        message: `Images must be ${MAX_BYTES / 1024 / 1024} MB or smaller`,
      });
    }
    // The client's `Content-Type` is not consulted: it is part of the body the
    // sender wrote, and declaring `image/png` in front of a script used to be
    // enough to have the script stored. What the bytes say is the whole check,
    // so a file whose header matches one of the five formats is accepted even if
    // the form named it something else, and one that does not is refused even if
    // the form insisted.
    if (!detectImageMime(file.buffer)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA',
        message: `Upload is not one of ${IMAGE_MIMES.join(', ')}`,
      });
    }
  }
}
