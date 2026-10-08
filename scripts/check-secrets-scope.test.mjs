import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const scanner = fileURLToPath(new URL('./check-secrets.sh', import.meta.url));
const gateStarted = 'Secret-scanner failure canary PASS; scanning complete HEAD ancestry with merge diffs';

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pachi-secret-scope-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet', '--initial-branch=base');
  git('config', 'user.name', 'Scope Fixture');
  git('config', 'user.email', 'scope-fixture@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  const write = (name, content) => writeFileSync(join(directory, name), content, { mode: 0o600 });
  const commit = (message) => {
    git('add', '--all');
    git('commit', '--quiet', '--message', message);
    return git('rev-parse', 'HEAD');
  };
  const canary = () => {
    // Generated disposable material, never a literal or a real credential.
    const { privateKey } = generateKeyPairSync('ed25519');
    const fixtureMaterial = privateKey.export({ type: 'pkcs8', format: 'pem' });
    write('fixture.pem', fixtureMaterial);
  };
  write('README.md', 'Clean synthetic repository\n');
  const root = commit('clean base');
  return { directory, git, write, commit, canary, root };
}

function scan(directory, expected) {
  // Exercise the actual gate, including pinned archive verification and its
  // failure canary; a download/setup error cannot satisfy a negative case.
  const result = spawnSync('bash', [scanner], { cwd: directory, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.error, undefined);
  assert.ok(result.stdout.includes(gateStarted), 'Pinned scanner and failure canary must execute before the history gate');
  assert.equal(result.status, expected, 'Unexpected mandatory history scan result');
}

test('secret scope A: a generated canary at HEAD fails the mandatory scan', (t) => {
  const repo = repository(t);
  repo.canary();
  repo.commit('synthetic canary at candidate head');
  scan(repo.directory, 1);
});

test('secret scope B: a removed canary in a reachable ancestor still fails', (t) => {
  const repo = repository(t);
  repo.canary();
  repo.commit('synthetic canary in ancestor');
  repo.git('rm', 'fixture.pem');
  repo.commit('remove fixture from latest tree');
  scan(repo.directory, 1);
});

test('secret scope C: an unrelated fetched branch canary does not contaminate a clean candidate', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'unrelated');
  repo.canary();
  const unrelated = repo.commit('synthetic canary only on unrelated branch');
  repo.git('update-ref', 'refs/remotes/preserved/unrelated', unrelated);
  scan(repo.directory, 1); // The same generated material is detected when reachable.
  repo.git('switch', 'base');
  assert.equal(repo.git('rev-parse', 'HEAD'), repo.root);
  scan(repo.directory, 0);
});

test('secret scope D: a PR merge scans removed secrets in current base ancestry', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'pr');
  repo.write('pr.txt', 'Clean PR change\n');
  repo.commit('PR change');
  repo.git('switch', 'base');
  repo.canary();
  repo.commit('synthetic canary in newer base');
  repo.git('rm', 'fixture.pem');
  repo.commit('clean current base tree');
  repo.git('merge', '--no-ff', 'pr', '--message', 'checkout-generated PR merge');
  scan(repo.directory, 1);
});

test('secret scope D: a PR merge also scans its second-parent PR ancestry', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'pr');
  repo.canary();
  repo.commit('synthetic canary in PR ancestor');
  repo.git('rm', 'fixture.pem');
  repo.commit('clean PR tree');
  repo.git('switch', 'base');
  repo.write('base.txt', 'Clean base advance\n');
  repo.commit('new current base');
  repo.git('merge', '--no-ff', 'pr', '--message', 'checkout-generated PR merge');
  scan(repo.directory, 1);
});

test('secret scope D: a canary introduced only by the merge commit fails', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'pr');
  repo.write('pr.txt', 'Clean PR change\n');
  repo.commit('PR change');
  repo.git('switch', 'base');
  repo.write('base.txt', 'Clean base advance\n');
  repo.commit('new current base');
  repo.git('merge', '--no-ff', '--no-commit', 'pr');
  repo.canary();
  repo.commit('merge introduces synthetic canary');
  scan(repo.directory, 1);
});

test('secret scope D: clean detached PR merge ancestry passes', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'pr');
  repo.write('pr.txt', 'Clean PR change\n');
  repo.commit('PR change');
  repo.git('switch', 'base');
  repo.write('base.txt', 'Clean base advance\n');
  repo.commit('new current base');
  repo.git('merge', '--no-ff', 'pr', '--message', 'checkout-generated PR merge');
  repo.git('checkout', '--detach', 'HEAD');
  scan(repo.directory, 0);
});

test('secret scope: shallow history is rejected before it can conceal an ancestor', (t) => {
  const repo = repository(t);
  repo.canary();
  repo.commit('synthetic canary in ancestor');
  repo.git('rm', 'fixture.pem');
  repo.commit('clean latest tree');
  const destination = mkdtempSync(join(tmpdir(), 'pachi-secret-scope-shallow-'));
  t.after(() => rmSync(destination, { recursive: true, force: true }));
  const clone = spawnSync('git', ['clone', '--quiet', '--depth=1', pathToFileURL(repo.directory).href, destination], { encoding: 'utf8' });
  assert.equal(clone.status, 0, clone.stderr);
  const result = spawnSync('bash', [scanner], { cwd: destination, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('shallow repositories are rejected'));
  assert.ok(!result.stdout.includes(gateStarted));
});

test('secret scope: octopus merge history is rejected rather than skipping merge-only content', (t) => {
  const repo = repository(t);
  repo.git('switch', '--create', 'pr-one');
  repo.write('one.txt', 'Clean first branch\n');
  repo.commit('first branch');
  repo.git('switch', '--create', 'pr-two', repo.root);
  repo.write('two.txt', 'Clean second branch\n');
  repo.commit('second branch');
  repo.git('switch', 'base');
  repo.write('base.txt', 'Clean base advance\n');
  repo.commit('new current base');
  repo.git('merge', '--no-ff', '--no-commit', 'pr-one', 'pr-two');
  repo.canary();
  repo.commit('octopus merge introduces synthetic canary');
  assert.equal(repo.git('show', '--no-patch', '--format=%P', 'HEAD').split(' ').length, 3);
  const result = spawnSync('bash', [scanner], { cwd: repo.directory, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('octopus merges are rejected'));
  assert.ok(!result.stdout.includes(gateStarted));
});
