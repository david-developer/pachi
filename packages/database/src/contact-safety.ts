import type postgres from 'postgres';

type Sql = postgres.Sql | postgres.TransactionSql;
/** One live predicate for future contact/viewing commands as well as messaging.
 * Callers creating activity hold SHARE on block_relationships before resource locks.
 */
export async function contactProhibited(sql: Sql, seekerId: string, providerAccountId: string, providerUserId: string | null): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM block_relationships WHERE revoked_at IS NULL AND (
    (blocker_user_id=${seekerId} AND (blocked_provider_account_id=${providerAccountId} OR blocked_user_id=${providerUserId})) OR
    (blocker_user_id=${providerUserId} AND blocked_user_id=${seekerId})) LIMIT 1`;
  return !!rows[0];
}
