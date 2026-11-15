import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ImageUrlPolicy } from './image-url-policy';
import { UploadQuota } from './upload-quota';

/**
 * Uploads only. `MediaService` is exported even though nothing in this project
 * injects it outside `MediaController` yet — the future caller is a delete or
 * replace route that has to retire a `publicId` after a listing edit, and
 * keeping the export costs one line.
 *
 * The service returns URLs; it never stores anything. Listing images are rows
 * in `listing_images` pointing at the Cloudinary URL the client got back from
 * `POST /api/media/images`, so upload and listing are separate requests and a
 * failed upload cannot leave half a listing behind.
 *
 * `ImageUrlPolicy` is the other half of that arrangement, exported for the two
 * modules that _receive_ those URLs: a route that stores a link has to know
 * which link it may believe, and only this module knows what the upload route
 * would have handed out.
 *
 * `UploadQuota` is the per-account ceiling on how much a student may push into
 * the media bucket each hour. It stays unexported and in process because only
 * `MediaService` spends it, and a restart that forgot it is an acceptable miss —
 * the same trade-off `MailCooldown` makes.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService, ImageUrlPolicy, UploadQuota],
  exports: [MediaService, ImageUrlPolicy],
})
export class MediaModule {}
