import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';
const admin = createRequire(new URL('../apps/admin/package.json', import.meta.url));
const sdk = createRequire(admin.resolve('@aws-sdk/client-cognito-identity-provider/package.json'));
const smithy = createRequire(sdk.resolve('@smithy/core/package.json'));

test('actual Cognito dependency resolves the authenticated compatible Smithy redaction fix', () => {
  assert.equal(sdk('./package.json').version, '3.1141.0');
  assert.equal(smithy('./package.json').version, '3.38.1');
  const packages = Object.assign({}, ...parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).map(d => d.toJSON().packages ?? {}));
  assert.deepEqual(Object.keys(packages).filter(k => k.startsWith('@smithy/core@')), ['@smithy/core@3.38.1']);
});

test('Smithy filters synthetic sensitive fields nested in lists and maps without mutating inputs', () => {
  // Upstream schemaLogFilter regression at 887a0945e2cf9c1a1bae98ecd5efa992b442fceb.
  const { schemaLogFilter } = sdk('@smithy/core/client');
  const sensitive = [0, 'pachi.synthetic', 'SensitiveString', { sensitive: 1 }, 0];
  const value = [3, 'pachi.synthetic', 'Value', 0, ['public', 'sensitive'], [0, sensitive]];
  const schema = [3, 'pachi.synthetic', 'Collections', 0, ['list', 'map'], [[1, 'pachi.synthetic', 'List', 0, value], [2, 'pachi.synthetic', 'Map', 0, 0, value]]];
  const input = { list: [{ public: 'visible', sensitive: 'synthetic-only' }], map: { key: { public: 'visible', sensitive: 'synthetic-only' } } };
  const before = structuredClone(input);
  assert.deepEqual(schemaLogFilter(schema, input), { list: [{ public: 'visible', sensitive: '***SensitiveInformation***' }], map: { key: { public: 'visible', sensitive: '***SensitiveInformation***' } } });
  assert.deepEqual(input, before);
});

test('Cognito request serialization and response handling remain compatible without network or credentials', async () => {
  const { CognitoIdentityProviderClient, AdminGetUserCommand } = admin('@aws-sdk/client-cognito-identity-provider');
  let requests = 0;
  const client = new CognitoIdentityProviderClient({
    region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC_TEST', secretAccessKey: 'SYNTHETIC_TEST' },
    requestHandler: { async handle(request) {
      requests++;
      assert.equal(request.headers['x-amz-target'], 'AWSCognitoIdentityProviderService.AdminGetUser');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(request.body)), { UserPoolId: 'us-east-1_SYNTHETIC', Username: 'synthetic-user' });
      return { response: { statusCode: 200, headers: { 'content-type': 'application/x-amz-json-1.1' }, body: Buffer.from(JSON.stringify({ Username: 'synthetic-user', Enabled: true, UserStatus: 'CONFIRMED' })) } };
    } },
  });
  try {
    const result = await client.send(new AdminGetUserCommand({ UserPoolId: 'us-east-1_SYNTHETIC', Username: 'synthetic-user' }));
    assert.equal(result.Username, 'synthetic-user'); assert.equal(result.Enabled, true); assert.equal(result.$metadata.httpStatusCode, 200); assert.equal(requests, 1);
  } finally { client.destroy(); }
});
