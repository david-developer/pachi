import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

void test('operator entrypoints load as ESM and reach input validation without database access', () => {
  const root = new URL('../', import.meta.url);
  for (const name of ['staff-identity', 'staff-grant', 'staff-revoke']) {
    const result = spawnSync(process.execPath, [
      '--import', fileURLToPath(new URL('node_modules/tsx/dist/loader.mjs', root)),
      fileURLToPath(new URL(`scripts/${name}.mts`, root)),
    ], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: Usage:/);
    assert.doesNotMatch(result.stderr, /Transform failed|ERR_PACKAGE_PATH_NOT_EXPORTED/);
  }
});
