import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminDirectoryService } from './admin-directory.service';
import { AdminService } from './admin.service';

/**
 * Two services, split where the routes split. `AdminService` is the five writes
 * that change who somebody is, each one owing a reason and an audit row;
 * `AdminDirectoryService` is the three reads an administrator asks before
 * deciding, which owe nothing and need no transaction.
 *
 * `DatabaseModule` is global, so the DataSource arrives without an import.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminDirectoryService],
  exports: [AdminService, AdminDirectoryService],
})
export class AdminModule {}
