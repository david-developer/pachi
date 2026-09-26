// Operator-only command; uses existing identity mappings, never links by email.
import { readFileSync } from 'node:fs';
import {
  createDatabase,
  StaffStore,
  validStaffScope,
  type StaffRole,
  type StaffScope,
} from '@pachi/database';
import { verifiedLocalUser } from '../lib/provider';
import { staffConfig } from '../lib/config';
const file = process.argv[2];
if (!file) throw new Error('Usage: pnpm --filter @pachi/admin staff:grant /private/grant.json');
const input = JSON.parse(readFileSync(file, 'utf8')) as {
  operator: string;
  userId: string;
  subject: string;
  role: StaffRole;
  scope: StaffScope;
  reason: string;
  expiresAt: string;
};
const c = staffConfig(),
  { client } = createDatabase(),
  store = new StaffStore(client);
try {
  if (
    !input.operator ||
    !/^[0-9a-f-]{36}$/i.test(input.userId) ||
    !input.subject ||
    !validStaffScope(input.role, input.scope) ||
    !Number.isFinite(+new Date(input.expiresAt))
  )
    throw new Error('INVALID_GRANT');
  const user = await verifiedLocalUser(input.subject);
  if (
    !user.Enabled ||
    !['CONFIRMED', 'FORCE_CHANGE_PASSWORD'].includes(user.UserStatus ?? '') ||
    user.UserAttributes?.find((a) => a.Name === 'sub')?.Value !== input.subject ||
    user.UserAttributes?.some((a) => a.Name === 'identities')
  )
    throw new Error('IDENTITY_UNVERIFIED');
  const grantId = await store.provision({
    ...input,
    issuer: c.issuer,
    expiresAt: new Date(input.expiresAt),
  });
  console.log(JSON.stringify({ event: 'staff_grant', outcome: 'SUCCESS', grant_id: grantId }));
} catch {
  // Keep provider errors and private identifiers out of terminal logs.
  if (/^[0-9a-f-]{36}$/i.test(input.userId ?? ''))
    await store.audit(
      input.operator || 'operator-command',
      input.userId,
      'staff:grant',
      'PROVISIONING_REJECTED',
      'DENIED',
      input.role ?? null,
      input.scope ?? null,
    );
  console.error(JSON.stringify({ event: 'staff_grant', outcome: 'DENIED' }));
  process.exitCode = 1;
} finally {
  await client.end();
}
