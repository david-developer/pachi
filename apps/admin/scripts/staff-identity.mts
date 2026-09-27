import { createRequire } from 'node:module';
// Creates a NEW Pachi principal for an operator-verified local staff subject.
// Existing users cannot be linked here; linking requires proof of both identities.
import { readFileSync } from 'node:fs';
import { createDatabase, StaffStore } from '@pachi/database';
const require = createRequire(import.meta.url);
const { staffConfig } = require('../lib/config.ts') as typeof import('../lib/config');
const { verifiedLocalUser } = createRequire(import.meta.url)('../lib/provider.ts') as typeof import('../lib/provider');
const file = process.argv[2];
if (!file) throw new Error('Usage: staff:identity /private/identity.json');
const input = JSON.parse(readFileSync(file, 'utf8')) as {
  operator: string;
  subject: string;
  displayName: string;
  reason: string;
};
const c = staffConfig(),
  { client } = createDatabase(),
  store = new StaffStore(client);
try {
  if (
    !input.operator?.trim() ||
    !input.subject ||
    !input.displayName?.trim() ||
    input.displayName.length > 100 ||
    input.reason?.trim().length < 10
  )
    throw new Error('INVALID_INPUT');
  const user = await verifiedLocalUser(input.subject);
  if (
    !user.Enabled ||
    !['CONFIRMED', 'FORCE_CHANGE_PASSWORD'].includes(user.UserStatus ?? '') ||
    user.UserAttributes?.find((a) => a.Name === 'sub')?.Value !== input.subject ||
    user.UserAttributes?.some((a) => a.Name === 'identities')
  )
    throw new Error('IDENTITY_UNVERIFIED');
  const id = await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${c.issuer}:${input.subject}`},0))`;
    const exists =
      await tx`SELECT id FROM auth_identities WHERE issuer=${c.issuer} AND subject=${input.subject}`;
    if (exists.length) throw new Error('IDENTITY_ALREADY_MAPPED');
    const rows = await tx<
      { id: string }[]
    >`INSERT INTO users(display_name) VALUES (${input.displayName}) RETURNING id`;
    const id = rows[0]!.id;
    await tx`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${id},${c.issuer},${input.subject},'COGNITO')`;
    await new StaffStore(tx as unknown as typeof client).audit(
      input.operator,
      id,
      'staff:identity',
      input.reason,
      'SUCCESS',
    );
    return id;
  });
  // The operator needs the explicitly identified app user ID for a separate grant.
  console.log(JSON.stringify({ event: 'staff_identity', outcome: 'SUCCESS', user_id: id }));
} catch {
  await store.audit(
    input.operator || 'operator-command',
    null,
    'staff:identity',
    'IDENTITY_PROVISIONING_REJECTED',
    'DENIED',
  );
  console.error(JSON.stringify({ event: 'staff_identity', outcome: 'DENIED' }));
  process.exitCode = 1;
} finally {
  await client.end();
}
