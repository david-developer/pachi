import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'pachi-contracts-typecheck-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'tsconfig.json', 'src']) {
    cpSync(join(packageRoot, file), join(directory, file), { recursive: true });
  }
  symlinkSync(join(packageRoot, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return directory;
}

function run(directory, script) {
  const { scripts } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const result = spawnSync(scripts[script], {
    cwd: directory,
    shell: true,
    env: { ...process.env, PATH: join(directory, 'node_modules', '.bin') + delimiter + process.env.PATH },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function outputs(directory) {
  return Object.fromEntries(readdirSync(join(directory, 'dist')).sort().map(file => [
    file, readFileSync(join(directory, 'dist', file), 'utf8'),
  ]));
}

test('contracts typecheck succeeds without generating dist', context => {
  const directory = fixture(context);
  run(directory, 'typecheck');
  assert.equal(existsSync(join(directory, 'dist')), false);
});

test('contracts typecheck preserves built declarations and JavaScript', context => {
  const directory = fixture(context);
  run(directory, 'build');
  const generated = outputs(directory);
  assert.match(generated['organization.d.ts'], /members: OrganizationMember\[\]/);
  assert.ok(Object.keys(generated).some(file => file.endsWith('.js')));

  // Comments expose even an identical compiler re-emission without relying on
  // filesystem timestamps or scheduler timing. Only disposable outputs change.
  for (const [file, content] of Object.entries(generated)) {
    writeFileSync(join(directory, 'dist', file), content + '\n// Preserve this disposable output.\n');
  }
  const before = outputs(directory);
  run(directory, 'typecheck');
  assert.deepEqual(outputs(directory), before);
});
