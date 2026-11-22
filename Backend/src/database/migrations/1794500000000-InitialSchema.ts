import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The whole schema, in the shape the application currently reads.
 *
 * Three things are worth knowing before reading it:
 *
 * 1. Table names are snake_case (`listing_images`), column names are
 *    camelCase ("emailVerified"), and both are quoted. That is what the
 *    previous tooling produced, and keeping it means a row written before this
 *    file existed is still readable by the entity that maps it. A rename would
 *    have been cleaner to look at and worse for the person who has to reconcile
 *    it with live data.
 *
 * 2. Every timestamp is `timestamptz`, never `timestamp`: an offset-less column
 *    is filled in using the session's own zone and read back as if it were UTC,
 *    so a `now()` comparison against an indexed column becomes a quiet six-hour
 *    bug (see the `ConvertTimestampsToUtc` entry in CHANGELOG). No column here is
 *    anything else.
 *
 * 3. Three things here are not derivable from the entities: the trigram indexes
 *    on listing title and description (they need `USING gin` and an extension),
 *    the unique index that lets only one PENDING inquiry exist per listing, and
 *    the two partial indexes that hold one open report per student and target.
 *    All of them are here, and only here.
 *
 * The class name is part of the contract, not a label. TypeORM decides what
 * still has to run by matching this name against the rows in its own
 * `migrations` table, so renaming the class would make every existing database
 * execute this file again — starting with a `CREATE TABLE "users"` that has
 * nowhere to go. It is also why folding the open-report indexes in here left any
 * existing database needing them by hand: README §9.3.
 */
export class InitialSchema1794500000000 implements MigrationInterface {
  name = 'InitialSchema1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE TYPE "Role" AS ENUM ('USER', 'MODERATOR', 'ADMIN');
      CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
      CREATE TYPE "ListingCategory" AS ENUM ('MARKETPLACE', 'TUITION', 'GROUP_FINDER', 'LOST_FOUND', 'COMMUTE');
      CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'CLOSED', 'HIDDEN');
      CREATE TYPE "InquiryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');
      CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'LISTING');
      CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');
      CREATE TYPE "NotificationType" AS ENUM ('INQUIRY_RECEIVED', 'INQUIRY_ACCEPTED', 'INQUIRY_DECLINED', 'INQUIRY_RESPONSE', 'ACCOUNT_UPDATE', 'VERIFICATION_UPDATE', 'MODERATION_UPDATE', 'SYSTEM');
      CREATE TYPE "ModerationActionType" AS ENUM ('HIDE_LISTING', 'UNHIDE_LISTING', 'SUSPEND_ACCOUNT', 'RESTORE_ACCOUNT', 'WARN_USER', 'CHANGE_ROLE', 'RESOLVE_REPORT', 'DISMISS_REPORT', 'MANUAL_VERIFICATION', 'PROFILE_CORRECTION', 'DELETE_ACCOUNT');

      CREATE TABLE "users" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        "passwordHash" TEXT,
        "image" TEXT,
        "role" "Role" NOT NULL DEFAULT 'USER',
        "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
        "department" TEXT,
        "bio" TEXT,
        "privateContact" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "users_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "profiles" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "headline" TEXT,
        "about" TEXT,
        "interests" TEXT,
        CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "sessions" (
        "id" TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "token" TEXT NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "verifications" (
        "id" TEXT NOT NULL,
        "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "listings" (
        "id" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL,
        "category" "ListingCategory" NOT NULL,
        "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "data" JSONB NOT NULL DEFAULT '{}',
        "locationText" TEXT,
        "price" DECIMAL(12,2),
        "currency" TEXT NOT NULL DEFAULT 'BDT',
        "closesAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "listing_images" (
        "id" TEXT NOT NULL,
        "listingId" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "uploaderId" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "inquiries" (
        "id" TEXT NOT NULL,
        "listingId" TEXT NOT NULL,
        "inquirerId" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL,
        "status" "InquiryStatus" NOT NULL DEFAULT 'PENDING',
        "message" TEXT NOT NULL,
        "sharedContact" TEXT,
        "ownerResponse" TEXT,
        "pendingKey" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "reports" (
        "id" TEXT NOT NULL,
        "reporterId" TEXT NOT NULL,
        "targetType" "ReportTargetType" NOT NULL,
        "targetUserId" TEXT,
        "targetListingId" TEXT,
        "reason" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'OTHER',
        "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
        "resolutionNote" TEXT,
        "resolvedById" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "blocks" (
        "id" TEXT NOT NULL,
        "blockerId" TEXT NOT NULL,
        "blockedId" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "notifications" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" "NotificationType" NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT,
        "link" TEXT,
        "readAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE "moderation_actions" (
        "id" TEXT NOT NULL,
        "moderatorId" TEXT NOT NULL,
        "action" "ModerationActionType" NOT NULL,
        "reason" TEXT NOT NULL,
        "targetType" "ReportTargetType",
        "targetUserId" TEXT,
        "targetListingId" TEXT,
        "reportId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
      CREATE INDEX "users_role_status_idx" ON "users" ("role", "status");
      CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles" ("userId");
      CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" ("token");
      CREATE INDEX "sessions_userId_idx" ON "sessions" ("userId");
      CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");
      CREATE INDEX "verifications_value_idx" ON "verifications" ("value");
      CREATE INDEX "listings_category_status_createdAt_idx" ON "listings" ("category", "status", "createdAt" DESC);
      CREATE INDEX "listings_ownerId_status_idx" ON "listings" ("ownerId", "status");
      CREATE INDEX "listing_images_listingId_idx" ON "listing_images" ("listingId");
      CREATE INDEX "inquiries_listingId_inquirerId_status_idx" ON "inquiries" ("listingId", "inquirerId", "status");
      CREATE INDEX "inquiries_ownerId_status_idx" ON "inquiries" ("ownerId", "status");
      CREATE INDEX "inquiries_inquirerId_status_idx" ON "inquiries" ("inquirerId", "status");
      CREATE UNIQUE INDEX "inquiries_pendingKey_key" ON "inquiries" ("pendingKey");
      CREATE INDEX "reports_status_createdAt_idx" ON "reports" ("status", "createdAt");
      -- One open report per student per target. The predicate is what makes the
      -- index partial: it must list the same statuses OPEN_STATUSES does, and
      -- adding a fourth waiting status there means changing it here. Only one of
      -- the two target columns is ever filled, so the key names the column rather
      -- than restating "targetType".
      CREATE UNIQUE INDEX "reports_open_listing_key" ON "reports" ("reporterId", "targetListingId")
        WHERE "status" IN ('OPEN', 'UNDER_REVIEW') AND "targetListingId" IS NOT NULL;
      CREATE UNIQUE INDEX "reports_open_user_key" ON "reports" ("reporterId", "targetUserId")
        WHERE "status" IN ('OPEN', 'UNDER_REVIEW') AND "targetUserId" IS NOT NULL;
      CREATE UNIQUE INDEX "blocks_blockerId_blockedId_key" ON "blocks" ("blockerId", "blockedId");
      CREATE INDEX "blocks_blockedId_idx" ON "blocks" ("blockedId");
      CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications" ("userId", "readAt", "createdAt" DESC);
      CREATE INDEX "moderation_actions_createdAt_idx" ON "moderation_actions" ("createdAt" DESC);

      -- Fuzzy search: an ILIKE pattern on a title or description is a full scan
      -- without these, and the platform is small enough that a scan is fine —
      -- until it is not. A gin trigram index is the cheap way to stay ahead.
      CREATE INDEX "listings_title_trgm_idx" ON "listings" USING gin ("title" gin_trgm_ops);
      CREATE INDEX "listings_description_trgm_idx" ON "listings" USING gin ("description" gin_trgm_ops);

      ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "listings" ADD CONSTRAINT "listings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_inquirerId_fkey" FOREIGN KEY ("inquirerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "reports" ADD CONSTRAINT "reports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "reports" ADD CONSTRAINT "reports_targetListingId_fkey" FOREIGN KEY ("targetListingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `);
  }

  /**
   * Reverse of `up`, in the opposite order. A migration that cannot be
   * undone is a migration you are afraid to run, and being afraid of the
   * database is not something a beginner should have to live with.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_reportId_fkey";
      ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_moderatorId_fkey";
      ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";
      ALTER TABLE "blocks" DROP CONSTRAINT "blocks_blockedId_fkey";
      ALTER TABLE "blocks" DROP CONSTRAINT "blocks_blockerId_fkey";
      ALTER TABLE "reports" DROP CONSTRAINT "reports_resolvedById_fkey";
      ALTER TABLE "reports" DROP CONSTRAINT "reports_targetListingId_fkey";
      ALTER TABLE "reports" DROP CONSTRAINT "reports_targetUserId_fkey";
      ALTER TABLE "reports" DROP CONSTRAINT "reports_reporterId_fkey";
      ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_ownerId_fkey";
      ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_inquirerId_fkey";
      ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_listingId_fkey";
      ALTER TABLE "listing_images" DROP CONSTRAINT "listing_images_uploaderId_fkey";
      ALTER TABLE "listing_images" DROP CONSTRAINT "listing_images_listingId_fkey";
      ALTER TABLE "listings" DROP CONSTRAINT "listings_ownerId_fkey";
      ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";
      ALTER TABLE "profiles" DROP CONSTRAINT "profiles_userId_fkey";

      DROP TABLE IF EXISTS "moderation_actions";
      DROP TABLE IF EXISTS "notifications";
      DROP TABLE IF EXISTS "blocks";
      DROP TABLE IF EXISTS "reports";
      DROP TABLE IF EXISTS "inquiries";
      DROP TABLE IF EXISTS "listing_images";
      DROP TABLE IF EXISTS "listings";
      DROP TABLE IF EXISTS "verifications";
      DROP TABLE IF EXISTS "sessions";
      DROP TABLE IF EXISTS "profiles";
      DROP TABLE IF EXISTS "users";

      DROP TYPE IF EXISTS "ModerationActionType";
      DROP TYPE IF EXISTS "NotificationType";
      DROP TYPE IF EXISTS "ReportStatus";
      DROP TYPE IF EXISTS "ReportTargetType";
      DROP TYPE IF EXISTS "InquiryStatus";
      DROP TYPE IF EXISTS "ListingStatus";
      DROP TYPE IF EXISTS "ListingCategory";
      DROP TYPE IF EXISTS "AccountStatus";
      DROP TYPE IF EXISTS "Role";
    `);
  }
}
