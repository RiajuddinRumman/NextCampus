import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ListingCategory } from '../../database/schema';
import { Public, VerifiedStudent } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser, OptionalCurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateListingDto,
  LISTING_CATEGORIES,
  LISTING_WRITE_STATUSES,
  MINE_LISTING_STATUSES,
  MineListingsQueryDto,
  SearchListingsQueryDto,
  UpdateListingDto,
  type ListingWriteStatus,
  type MineListingsStatus,
} from './dto/listing.dto';
import { ListingsService } from './listings.service';

/**
 * The five notice boards of the platform: marketplace, tuition, group finder,
 * lost and found, commute.
 *
 * Browsing is public (`@Public`), posting is not: `@VerifiedStudent` requires a
 * verified address on the institution's own domain
 * (`src/config/env.ts`), so a listing always traces back to a real
 * student.
 */
@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search active listings across all five categories' })
  search(@Query() query: SearchListingsQueryDto, @OptionalCurrentUser() viewer: AuthUser | null) {
    return this.listings.search(query, viewer ? { id: viewer.id, role: viewer.role } : undefined);
  }

  @VerifiedStudent()
  @Get('mine')
  @ApiQuery({ name: 'status', required: false, enum: MINE_LISTING_STATUSES })
  @ApiOperation({ summary: 'Own listings, including closed and hidden ones' })
  mine(@CurrentUser() user: AuthUser, @Query() query: MineListingsQueryDto) {
    // Kept as an explicit check rather than a DTO rule so the answer stays
    // BAD_STATUS, the code clients already branch on.
    const normalized = (query.status ?? 'ALL').toUpperCase() as MineListingsStatus;
    if (!MINE_LISTING_STATUSES.includes(normalized)) {
      throw new BadRequestException({
        code: 'BAD_STATUS',
        message: 'status must be ALL, ACTIVE, CLOSED or HIDDEN',
      });
    }
    return this.listings.mine(user.id, normalized, query);
  }

  @VerifiedStudent()
  @Post()
  @ApiOperation({ summary: 'Publish a listing in one of the five categories' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateListingDto) {
    return this.listings.create(user.id, body);
  }

  @Public()
  @Get('facets/:category')
  @ApiOperation({ summary: 'Filter values available for a category' })
  facets(@Param('category') category: string) {
    return this.listings.facets(this.toCategory(category));
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Listing detail; hidden listings require the owner or staff' })
  detail(@Param('id') id: string, @OptionalCurrentUser() viewer: AuthUser | null) {
    return this.listings.detail(id, viewer ? { id: viewer.id, role: viewer.role } : undefined);
  }

  @VerifiedStudent()
  @Patch(':id')
  @ApiOperation({ summary: 'Edit an own listing' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdateListingDto) {
    return this.listings.update(id, user.id, body);
  }

  @VerifiedStudent()
  @Patch(':id/status')
  @ApiOperation({ summary: 'Reopen or close an own listing' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('status') status: string,
  ) {
    const normalized = (status ?? '').toUpperCase() as ListingWriteStatus;
    if (!LISTING_WRITE_STATUSES.includes(normalized)) {
      throw new BadRequestException({
        code: 'BAD_STATUS',
        message: 'status must be ACTIVE or CLOSED',
      });
    }
    return this.listings.setStatus(id, user.id, normalized);
  }

  @VerifiedStudent()
  @Post(':id/resolve')
  @ApiOperation({ summary: 'Mark a lost or found report as resolved and close it' })
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.resolveLostFound(id, user.id);
  }

  private toCategory(value: string): ListingCategory {
    const normalized = (value ?? '').toUpperCase() as ListingCategory;
    if (!LISTING_CATEGORIES.includes(normalized)) {
      throw new BadRequestException({
        code: 'BAD_CATEGORY',
        message: `category must be one of ${LISTING_CATEGORIES.join(', ')}`,
      });
    }
    return normalized;
  }
}
