import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { detectImageMime, IMAGE_MIMES } from './image-signature';
import { UploadQuota } from './upload-quota';

export const MAX_FILES = 4;
export const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
}

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
            if (!uploaded) {
              return reject(new Error('Cloudinary upload failed: no response from the service'));
            }
            return resolve(uploaded);
          }
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
    if (!detectImageMime(file.buffer)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA',
        message: `Upload is not one of ${IMAGE_MIMES.join(', ')}`,
      });
    }
  }
}
