import { readFileSync } from 'node:fs';
import { createDatabase, StaffStore, type StaffScope } from '@pachi/database';
const file = process.argv[2];
if (!file) throw new Error('Usage: staff:revoke /private/revoke.json');
const input = JSON.parse(readFileSync(file, 'utf8')) as {
  operator: string;
  grantId: string;
  reason: string;
};
if (
  !input.operator?.trim() ||
  !/^[0-9a-f-]{36}$/i.test(input.grantId) ||
  input.reason?.trim().length < 10
)
  throw new Error('INVALID_INPUT');
const { client } = createDatabase();
try {
  await client.begin(async (tx) => {
    const rows = await tx<
      { user_id: string; role: string; permission_scope: StaffScope }[]
    >`UPDATE staff_grants SET revoked_at=COALESCE(revoked_at,now()),updated_at=now(),version=version+1 WHERE id=${input.grantId} RETURNING user_id,role,permission_scope`;
    const row = rows[0];
    if (row)
      await tx`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=${row.user_id}`;
    await new StaffStore(tx as unknown as typeof client).audit(
      input.operator,
      row?.user_id ?? null,
      'staff:revoke',
      input.reason,
      row ? 'SUCCESS' : 'NOT_FOUND',
      row?.role ?? null,
      row?.permission_scope ?? null,
    );
  });
  console.log(JSON.stringify({ event: 'staff_grant_revoke', outcome: 'COMPLETE' }));
} catch {
  console.error(JSON.stringify({ event: 'staff_grant_revoke', outcome: 'FAILED' }));
  process.exitCode = 1;
} finally {
  await client.end();
}
