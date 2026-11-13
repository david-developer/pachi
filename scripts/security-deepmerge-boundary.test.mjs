import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const versions = ['12.0.14', '55.0.21'];
const scenario = process.argv[2] === '--config-remediation-fixture' ? process.argv[3] : undefined;
const store = fileURLToPath(new URL('../node_modules/.pnpm/', import.meta.url));
function consumer(version) {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const parent = version === '55.0.21'
    ? createRequire(mobile.resolve('expo/package.json'))
    : createRequire(createRequire(mobile.resolve('expo-router/package.json')).resolve('expo-constants/package.json'));
  return createRequire(parent.resolve('@expo/config/package.json'));
}
function plain(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal('pachiPoison' in value, false);
  for (const item of Object.values(value)) plain(item);
}
if (scenario) {
  assert.ok(versions.includes(scenario));
  const require = consumer(scenario);
  assert.equal(require('./package.json').version, scenario);
  assert.throws(() => require.resolve('deepmerge'), { code: 'MODULE_NOT_FOUND' });
  const { mergeConfig } = require('./build/mergeConfig.js');
  const serializers = require('./build/Serialize.js');
  // Authentic Expo #52602 regressions, exercised through both installed backports.
  const poison = JSON.parse('{"__proto__":{"pachiPoison":true},"extra":{"setting":{"__proto__":{"pachiPoison":true},"safe":true}},"items":[{"__proto__":{"pachiPoison":true},"safe":true}]}');
  for (const result of [mergeConfig(poison, {}), mergeConfig({}, poison), mergeConfig({ extra: { setting: 'old' } }, poison)]) plain(result);
  assert.equal(Object.prototype.pachiPoison, undefined);
  const inherited = { constructor: { inherited: true } };
  const reserved = { constructor: { prototype: { safe: true } }, toString: 'keep', hasOwnProperty: 'keep' };
  assert.deepEqual(mergeConfig({ extra: Object.create(inherited) }, { extra: reserved }).extra, reserved);
  assert.deepEqual(inherited.constructor, { inherited: true });
  const nullObject = Object.assign(Object.create(null), { hasOwnProperty: 'data', safe: true });
  assert.deepEqual(mergeConfig({}, { extra: nullObject }).extra, { hasOwnProperty: 'data', safe: true });
  const shared = { value: 1 };
  assert.deepEqual(mergeConfig({}, { first: shared, second: [shared, shared] }), { first: shared, second: [shared, shared] });
  const circular = {}; circular.items = [circular];
  assert.throws(() => mergeConfig(circular, {}), /circular reference/);
  assert.throws(() => mergeConfig({}, circular), /circular reference/);
  const symbol = Symbol('synthetic');
  assert.equal(mergeConfig({}, { [symbol]: 1 })[symbol], 1);
  const date = new Date(0); const regex = /synthetic/;
  assert.equal(mergeConfig({}, { date }).date, date);
  assert.equal(mergeConfig({}, { regex }).regex, regex);
  assert.deepEqual(mergeConfig({ list: [1], nested: { old: true } }, { list: [2], nested: { new: true } }), { list: [1, 2], nested: { old: true, new: true } });
  for (const serialize of Object.values(serializers).filter(value => typeof value === 'function')) {
    plain(serialize(poison));
    assert.deepEqual(serialize({ extra: nullObject }).extra, { hasOwnProperty: 'data', safe: true });
  }
  plain(serializers.serializeAfterStaticPlugins({ plugins: [['fixture', poison]] }));
  const { getConfig, modifyConfigAsync } = require('./build/Config.js');
  const directory = await mkdtemp(join(tmpdir(), 'pachi-config-remediation-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-config', version: '1.0.0' }));
    const config = { expo: { name: 'Synthetic config', slug: 'synthetic-config', extra: { keep: true }, plugins: [['fixture', { keep: true }]], updates: { requestHeaders: { original: 'synthetic' } } } };
    const original = JSON.stringify(config);
    await writeFile(join(directory, 'app.json'), original);
    const options = { skipSDKVersionRequirement: true, skipPlugins: true };
    assert.deepEqual(getConfig(directory, options).exp.extra, { keep: true });
    const changes = JSON.parse('{"extra":{"__proto__":{"pachiPoison":true},"new":true},"plugins":[["fixture",{"__proto__":{"pachiPoison":true},"new":true}],"toString"],"updates":{"requestHeaders":{"new":"synthetic"}}}');
    const result = await modifyConfigAsync(directory, changes, options, { dryRun: true });
    assert.equal(result.type, 'success'); plain(result.config);
    assert.deepEqual(result.config.extra, { keep: true, new: true });
    assert.deepEqual(result.config.plugins, [['fixture', { keep: true, new: true }], 'toString']);
    assert.deepEqual(result.config.updates.requestHeaders, { original: 'synthetic', new: 'synthetic' });
    assert.equal(readFileSync(join(directory, 'app.json'), 'utf8'), original);
    const written = await modifyConfigAsync(directory, { extra: nullObject }, options);
    assert.equal(written.type, 'success');
    assert.deepEqual(getConfig(directory, options).exp.extra, { keep: true, hasOwnProperty: 'data', safe: true });
    await writeFile(join(directory, 'app.config.js'), 'module.exports = ({ config }) => ({ ...config, extra: { ...config.extra, dynamic: true } });\n');
    const dynamic = await modifyConfigAsync(directory, Object.assign(Object.create(null), { description: 'Synthetic TEST' }), options);
    assert.equal(dynamic.type, 'success');
    assert.equal(dynamic.config.description, 'Synthetic TEST');
    assert.equal(dynamic.config.extra.dynamic, true);
    assert.equal(Object.prototype.pachiPoison, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
} else {
  test('deepmerge is eliminated from every locked and installed dependency path', () => {
    const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
    assert.ok(documents.every(document => !document.errors.length));
    for (const document of documents.map(value => value.toJSON())) {
      assert.equal(Object.keys(document.packages ?? {}).some(name => name.startsWith('deepmerge@')), false);
      for (const record of Object.values(document.snapshots ?? {})) {
        assert.equal(record.dependencies?.deepmerge, undefined);
        assert.equal(record.optionalDependencies?.deepmerge, undefined);
      }
    }
    assert.equal(readdirSync(store).some(name => name.startsWith('deepmerge@')), false);
    for (const version of versions) assert.throws(() => consumer(version).resolve('deepmerge'), { code: 'MODULE_NOT_FOUND' });
  });
  for (const version of versions) test(`Expo config ${version} rejects prototype poisoning and preserves config and plugin edits`, () => {
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', fileURLToPath(import.meta.url), '--config-remediation-fixture', version], { encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024 });
    assert.ifError(child.error); assert.equal(child.signal, null, child.stderr); assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}
