import { config as readDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { entities } from '../../../database/entities';
import { InitialSchema1794500000000 } from '../../../database/migrations/1794500000000-InitialSchema';

readDotenv();

export const dataSourceOptions = {
  type: 'postgres' as const,
  url: process.env.DATABASE_URL,
  entities,
  migrations: [InitialSchema1794500000000],
  synchronize: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);

export function createDataSource(): DataSource {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env and try again');
  }
  return new DataSource(dataSourceOptions);
}
