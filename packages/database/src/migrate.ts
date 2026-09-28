import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

const { client, db } = createDatabase();
try {
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  console.log(JSON.stringify({ event: 'database_migration_complete' }));
} finally {
  await client.end();
}
