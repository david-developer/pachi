import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema.js';

const environmentSchema = z.object({ DATABASE_URL: z.string().url() });

export function databaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return environmentSchema.parse({ DATABASE_URL: environment.DATABASE_URL }).DATABASE_URL;
}

export function createDatabase(url = databaseUrl()) {
  const client = postgres(url, { max: 5, prepare: false });
  return { client, db: drizzle(client, { schema }) };
}
