import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { VerifiedStudent } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MAX_BYTES, MAX_FILES, MediaService } from './media.service';

const uploadInterceptor = FileFieldsInterceptor([{ name: 'images', maxCount: MAX_FILES }], {
  storage: memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FILES },
});

@ApiTags('media')
@VerifiedStudent()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('images')
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { images: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({ summary: 'Upload listing or report images, returns URLs for listing payloads' })
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    const images = files?.images ?? [];
    if (!images.length) {
      throw new BadRequestException({ code: 'NO_FILES', message: 'Attach at least one image' });
    }
    return this.media.uploadMany(images, user.id);
  }
}
