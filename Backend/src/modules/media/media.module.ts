import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ImageUrlPolicy } from './image-url-policy';
import { UploadQuota } from './upload-quota';

@Module({
  controllers: [MediaController],
  providers: [MediaService, ImageUrlPolicy, UploadQuota],
  exports: [MediaService, ImageUrlPolicy],
})
export class MediaModule {}
