import { ConfigModule, ConfigService } from '@nestjs/config';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';
import { entities } from '../../../database/entities';

/**
 * The one connection the application runs on, and the reason every feature
 * module can ask for a repository without knowing anything about Postgres.
 *
 * `@Global()` plus `exports: [TypeOrmModule]` is what makes
 * `@InjectRepository(Listing)` work inside any module without that module
 * importing anything. The old `PrismaModule` was global for the same reason: a
 * service that reads two tables should not have to import a database module to
 * be allowed to do it.
 *
 * The connection itself is configured from the environment through
 * `ConfigService` rather than read off `process.env` here, so a missing or
 * malformed `DATABASE_URL` fails at start-up with a message about the setting
 * instead of a socket error forty requests later.
 *
 * `autoLoadEntities` is not used on purpose: `entities` above is the same
 * list the CLI and the seed script build their connection from, so the schema
 * the running server sees and the schema a migration writes cannot disagree.
 *
 * `providers/` holds how the application reaches a database; `database/` holds
 * what the database contains. Both files here import the entity list across
 * that line, which is the point: one description of the schema, two consumers.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...dataSourceOptions,
        url: config.getOrThrow<string>('DATABASE_URL'),
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
