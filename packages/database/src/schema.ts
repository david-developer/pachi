import { sql } from 'drizzle-orm';
import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() { return 'geography(point, 4326)'; },
  toDriver(value) { return sql.raw(`ST_GeogFromText('SRID=4326;${value}')`) as unknown as string; }
});

export const foundationMetadata = pgTable('foundation_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
