import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function fixture(context: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'pachi-database-typecheck-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'tsconfig.json', 'src']) {
    cpSync(join(packageRoot, file), join(directory, file), { recursive: true });
  }
  symlinkSync(join(packageRoot, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return directory;
}

function run(directory: string, script: 'build' | 'typecheck'): void {
  const { scripts } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const result = spawnSync(scripts[script]!, {
    cwd: directory,
    shell: true,
    env: { ...process.env, PATH: join(directory, 'node_modules', '.bin') + delimiter + process.env.PATH },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function outputs(directory: string): Record<string, Buffer> {
  const dist = join(directory, 'dist');
  return Object.fromEntries(readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter(file => file.isFile())
    .map(file => {
      const fullPath = join(file.parentPath, file.name);
      return [fullPath, readFileSync(fullPath)];
    }));
}

function outputHashes(directory: string): Record<string, string> {
  return Object.fromEntries(Object.entries(outputs(directory))
    .map(([file, content]) => [file, createHash('sha256').update(content).digest('hex')]));
}

function runtimeExports(directory: string): void {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as database from './dist/index.js';
    import * as owner from './dist/organization-owner-lifecycle.js';
    assert.deepEqual(database.ORDINARY_ORGANIZATION_ROLES, ['LISTING_MANAGER', 'AGENT', 'ANALYST']);
    assert.equal(typeof owner.OrganizationOwnerStore, 'function');
  `], { cwd: directory, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

void test('database typecheck succeeds without generating dist', context => {
  const directory = fixture(context);
  run(directory, 'typecheck');
  assert.equal(existsSync(join(directory, 'dist')), false);
});

void test('database build exports ordinary roles and typecheck preserves runtime artifacts', context => {
  const directory = fixture(context);
  run(directory, 'build');
  assert.match(readFileSync(join(directory, 'dist', 'organization-lifecycle.d.ts'), 'utf8'),
    /ORDINARY_ORGANIZATION_ROLES: readonly \["LISTING_MANAGER", "AGENT", "ANALYST"\]/);
  assert.match(readFileSync(join(directory, 'dist', 'organization-owner-lifecycle.js'), 'utf8'),
    /import \{ ORDINARY_ORGANIZATION_ROLES \} from '\.\/organization-lifecycle\.js'/);
  runtimeExports(directory);
  // Sentinels expose even identical re-emission without relying on timestamps.
  // All writes are confined to this disposable fixture.
  for (const [file, content] of Object.entries(outputs(directory))) {
    writeFileSync(file, Buffer.concat([content, Buffer.from('\n// Preserve this disposable output.\n')]));
  }
  const before = outputHashes(directory);
  run(directory, 'typecheck');
  assert.deepEqual(outputHashes(directory), before);
  runtimeExports(directory);
});
