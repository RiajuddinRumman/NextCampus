import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportWorklistService } from './report-worklist.service';
import { ReportsService } from './reports.service';

/**
 * Reporting and the queue that consumes reports — one module because a report
 * only makes sense together with the decision made on it.
 *
 * Two services, split where the routes split: `ReportsService` files a report
 * and closes one, `ReportWorklistService` reads the page a moderator decides
 * from. Neither is injected outside this module, and `ReportsService` is
 * exported only for symmetry with the other feature modules. Staff decision
 * logic that a report *triggers* (hiding a listing, suspending an account)
 * lives in `ModerationService` and is reached by the moderator through separate
 * `POST /api/moderation/...` calls, so resolving a report never silently
 * performs a second action that the audit trail cannot attribute to a person.
 *
 * The queue is why this module also reads `Listing`, `ModerationAction` and
 * `Block`: a moderator deciding one report needs the account's prior reports and
 * prior outcomes, and a report about someone's listing counts as a report about
 * them.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportWorklistService],
  exports: [ReportsService],
})
export class ReportsModule {}
