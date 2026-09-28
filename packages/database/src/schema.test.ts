import assert from 'node:assert/strict';
import test from 'node:test';
import { pgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { geographyPoint } from './schema.js';

void test('geography input stays a bound value, including SQL metacharacters', async () => {
  const client = postgres('postgresql://localhost:5433/pachi_test');
  try {
    const table = pgTable('synthetic_geography', { point: geographyPoint('point') });
    const value = "POINT(9 4)'); DROP TABLE users; --";
    const query = drizzle(client).insert(table).values({point:value}).toSQL();
    assert.equal(query.sql.includes('DROP TABLE'),false);
    assert.deepEqual(query.params,[`SRID=4326;${value}`]);
  } finally { await client.end(); }
});
