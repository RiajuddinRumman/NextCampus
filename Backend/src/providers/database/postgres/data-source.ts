import { config as readDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { entities } from '../../../database/entities';
import { InitialSchema1794500000000 } from '../../../database/migrations/1794500000000-InitialSchema';

/**
 * The database connection, described once.
 *
 * The application does not use this object — `DatabaseModule` builds an
 * equivalent one through Nest — but the migration CLI and the e2e harness need
 * a plain connection with no Nest running, and they must agree with the
 * application about what the schema is. Two definitions that can drift is the
 * bug; this file and `database.module.ts` both import the same `entities` list
 * and the same migration classes for that reason.
 *
 * `synchronize` is deliberately absent, because its default is false. Setting
 * it to true would let TypeORM reshape tables to match the entities whenever
 * the server starts, which is exactly what you want on a throwaway branch and
 * what you never want near data somebody registered an account into. Schema
 * change goes through a migration file, which is reviewed, ordered, and can be
 * undone.
 */
// Loaded here rather than by each script: the CLI and the e2e harness both
// reach the schema through this file, and dotenv never overwrites a variable
// that is already set, so an explicit DATABASE_URL still wins.
readDotenv();

export const dataSourceOptions = {
  type: 'postgres' as const,
  url: process.env.DATABASE_URL,
  entities,
  migrations: [InitialSchema1794500000000],
  synchronize: false,
};

/**
 * The connection the TypeORM command line works on. It is not initialised by
 * being created — nothing connects until something calls `initialize()` — so
 * importing this file from the application costs nothing, and `npx
 * typeorm ... -d src/providers/database/postgres/data-source.ts` has the
 * instance it requires.
 */
export const AppDataSource = new DataSource(dataSourceOptions);

/** A fresh connection for the scripts: `createDataSource()` then `initialize()`. */
export function createDataSource(): DataSource {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env and try again');
  }
  return new DataSource(dataSourceOptions);
}
