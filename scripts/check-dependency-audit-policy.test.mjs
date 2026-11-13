import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse, parseAllDocuments } from 'yaml';
import { validateDependencyAuditPolicy as validate } from './check-dependency-audit-policy.mjs';

const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
const lockfile = parseAllDocuments(readFileSync('pnpm-lock.yaml', 'utf8'))
  .map(document => document.toJSON()).find(document => document.importers?.['apps/mobile']);
const approvedIds = ['GHSA-g3hv-75wg-m249', 'GHSA-c859-jr93-m5j4'];
const acceptedParent = Object.keys(lockfile.snapshots).find(name => name.startsWith('@expo/fingerprint@0.16.5('));
const options = { now: '2026-11-13T12:00:00Z', environment: 'development-ci', lockfile };
const check = (configuration = workspace, document = readiness, changes = {}) => validate(configuration, document, { ...options, ...changes });
const audit = changes => ({ ...workspace, audit: { ...workspace.audit, ...changes } });
const changeGraph = change => { const graph = structuredClone(lockfile); change(graph); return graph; };
const histories = [
  ['GHSA-gcqx-w48m-w2h4', /Retired deepmerge history/],
  ['GHSA-86w9-cpqp-85rv', /Retired node-forge acceptance history/],
  ['GHSA-vfj7-8cjw-p6xm', /withdrawn advisory history/],
  ['GHSA-hp3w-g68c-fv3c', /withdrawn advisory history/],
];
function changeRecord(id, change) {
  const start = readiness.indexOf(`- **Advisory:** \`${id}\``);
  const match = readiness.slice(start).match(/^- \*\*Temporarily accepted:\*\* [^\n]+/m);
  assert.ok(start >= 0 && match);
  const end = start + match.index + match[0].length;
  return readiness.slice(0, start) + change(readiness.slice(start, end)) + readiness.slice(end);
}

test('strict-low accepts only the two approved fingerprint minimatch identities and intact histories', () => {
  assert.deepEqual(workspace.audit, { level: 'low', ignore: approvedIds });
  assert.ok(acceptedParent);
  assert.doesNotThrow(() => check());
});
for (const level of ['moderate', 'high', 'critical', undefined]) test(`threshold ${level} is rejected`, () => {
  assert.throws(() => check(audit({ level })), /threshold must remain low/);
});
for (const key of ['ignoreRegistryErrors', 'ignoreUnfixable', 'ignore-unfixable']) test(`${key} is rejected even when false`, () => {
  assert.throws(() => check(audit({ [key]: false })), /suppression options are not approved/);
});
for (const id of [...histories.map(([id]) => id), 'GHSA-3g3m-2fjr-6pw4', 'GHSA-w4cr-vjpx-p82q', '*']) test(`no retired or unapproved suppression can add ${id}`, () => {
  assert.throws(() => check(audit({ ignore: [...approvedIds, id] })), /exactly match/);
});
for (const ignore of [undefined, {}, '', [], [approvedIds[0]], [approvedIds[1]], [...approvedIds].reverse(), [...approvedIds, approvedIds[0]]]) test(`incomplete or changed allowlist ${JSON.stringify(ignore)} fails closed`, () => {
  assert.throws(() => check(audit({ ignore })), /exactly match/);
});
test('an unapproved active record cannot be hidden alongside the approved records', () => {
  const document = readiness.replace('### Temporary dependency-audit exceptions\n', '### Temporary dependency-audit exceptions\n\n- **Advisory:** `GHSA-gcqx-w48m-w2h4`\n');
  assert.throws(() => check(workspace, document), /exactly match workspace/);
});
test('the explicit audit policy section cannot be deleted', () => {
  assert.throws(() => check(workspace, readiness.replace('### Temporary dependency-audit exceptions', '### Missing policy')), /section must remain documented/);
});
for (const id of approvedIds) test(`${id} preserves the complete approved decision, scope, controls and deadline`, () => {
  for (const field of ['Package', 'Provenance', 'Runtime/build exposure', 'Reason', 'Compensating controls', 'Owner', 'Created on', 'Reviewed on', 'Owner decision on', 'Owner decision', 'Review by', 'Risk history', 'Removal trigger', 'Vulnerability fixed', 'Temporarily accepted']) {
    const line = new RegExp(`(^- \\*\\*${field}:\\*\\* )[^\\n]+`, 'm');
    const altered = changeRecord(id, record => { assert.match(record, line); return record.replace(line, '$1UNAPPROVED'); });
    assert.throws(() => check(workspace, altered), /complete approved minimatch record/);
  }
  assert.throws(() => check(workspace, changeRecord(id, record => record.replace('- **Created on:**', '- **Created on:** UNAPPROVED\n- **Created on:**'))), /complete approved minimatch record/);
  assert.throws(() => check(workspace, changeRecord(id, () => '')), /exactly match workspace/);
});
test('acceptance is valid through the last millisecond before its exact UTC expiration', () => {
  assert.doesNotThrow(() => check(workspace, readiness, { now: '2026-11-19T23:59:59.999Z' }));
});
for (const now of ['2026-11-20T00:00:00.000Z', '2026-11-20T03:00:00+03:00', '2026-11-20T00:00:00.001Z', '2026-11-21T00:00:00Z']) test(`fixed expiration rejects ${now} without grace or automatic renewal`, () => {
  assert.throws(() => check(workspace, readiness, { now }), /expired at 2026-11-20T00:00:00Z/);
});
for (const now of ['invalid', '2026-11-12T23:59:59.999Z']) test(`invalid or pre-assessment time ${now} is rejected`, () => {
  assert.throws(() => check(workspace, readiness, { now }), /assessment\/decision cannot be in the future/);
});
test('production cannot reuse the development and CI acceptance', () => {
  assert.throws(() => check(workspace, readiness, { environment: 'production' }), /development\/CI only; production deployment remains blocked/);
});
for (const version of ['9.0.9', '10.2.5', '11.0.7']) test(`an additional minimatch${version} resolution is not accepted`, () => {
  const graph = changeGraph(value => { value.packages[`minimatch@${version}`] = {}; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /exact reviewed versions/);
});
test('the acceptance cannot hide a removed or remediated reviewed matcher resolution', () => {
  const graph = changeGraph(value => { delete value.packages['minimatch@10.2.6']; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /exact reviewed versions/);
});
for (const kind of ['dependencies', 'optionalDependencies']) test(`an additional ${kind} parent of minimatch10.2.6 is rejected`, () => {
  const graph = changeGraph(value => { value.snapshots['unreviewed-tool@1.0.0'] = { [kind]: { minimatch: '10.2.6' } }; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /only the exact fingerprint0\.16\.5/);
});
test('a renamed alias cannot create another minimatch10.2.6 parent', () => {
  const graph = changeGraph(value => { value.snapshots['unreviewed-tool@1.0.0'] = { dependencies: { matcher: 'minimatch@10.2.6' } }; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /only the exact fingerprint0\.16\.5/);
});
test('the accepted dependency cannot silently move to another fingerprint version', () => {
  const graph = changeGraph(value => { value.snapshots[acceptedParent.replace('@0.16.5', '@0.16.8')] = value.snapshots[acceptedParent]; delete value.snapshots[acceptedParent]; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /only the exact fingerprint0\.16\.5/);
});
test('the accepted dependency cannot silently become optional', () => {
  const graph = changeGraph(value => { delete value.snapshots[acceptedParent].dependencies.minimatch; value.snapshots[acceptedParent].optionalDependencies = { minimatch: '10.2.6' }; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /only the exact fingerprint0\.16\.5/);
});
for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) test(`direct importer ${kind} cannot use the accepted matcher`, () => {
  const graph = changeGraph(value => { value.importers['apps/mobile'][kind] = { ...value.importers['apps/mobile'][kind], minimatch: { specifier: '10.2.6', version: '10.2.6' } }; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /direct application\/importer dependency/);
});
test('a direct importer alias cannot use the accepted matcher', () => {
  const graph = changeGraph(value => { value.importers['apps/mobile'].dependencies.matcher = { specifier: 'npm:minimatch@10.2.6', version: 'minimatch@10.2.6' }; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /direct application\/importer dependency/);
});
test('fingerprint must retain the reviewed backport hash', () => {
  const graph = changeGraph(value => { value.patchedDependencies['@expo/fingerprint@0.16.5'] = 'unreviewed'; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /reviewed fingerprint backport/);
});
test('fingerprint must retain the reviewed patch path', () => {
  const configuration = structuredClone(workspace);
  configuration.patchedDependencies['@expo/fingerprint@0.16.5'] = 'patches/unreviewed.patch';
  assert.throws(() => check(configuration), /reviewed fingerprint backport/);
});
test('an absent or incomplete project lock cannot authorize an exception', () => {
  assert.throws(() => check(workspace, readiness, { lockfile: {} }), /complete project lockfile/);
  const graph = changeGraph(value => { delete value.snapshots; });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /complete project lockfile/);
});
test('another workspace cannot reuse the existing accepted Expo snapshot', () => {
  const graph = changeGraph(value => {
    value.importers['apps/api'].dependencies.expo = structuredClone(value.importers['apps/mobile'].dependencies.expo);
  });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /confined to the reviewed apps\/mobile dependency graph/);
});
test('a direct workspace link cannot expose the accepted mobile graph to the API', () => {
  const graph = changeGraph(value => {
    value.importers['apps/api'].dependencies['@pachi/mobile'] = { specifier: 'workspace:*', version: 'link:../mobile' };
  });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /confined to the reviewed apps\/mobile dependency graph/);
});
test('a transitive workspace link cannot expose the accepted mobile graph through contracts', () => {
  const graph = changeGraph(value => {
    assert.equal(value.importers['apps/api'].dependencies['@pachi/contracts'].version, 'link:../../packages/contracts');
    value.importers['packages/contracts'].dependencies = {
      ...value.importers['packages/contracts'].dependencies,
      '@pachi/mobile': { specifier: 'workspace:*', version: 'link:../../apps/mobile' },
    };
  });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /confined to the reviewed apps\/mobile dependency graph/);
});
for (const [alias, specifier, target] of [
  ['expo-alias', 'npm:expo@55.0.0', Object.keys(lockfile.snapshots).find(name => lockfile.snapshots[name].dependencies?.['@expo/fingerprint'])],
  ['fingerprint-alias', 'npm:@expo/fingerprint@0.16.5', acceptedParent],
]) test(`a server alias ${alias} cannot reuse the accepted upstream graph`, () => {
  const graph = changeGraph(value => {
    assert.ok(target && value.snapshots[target]);
    value.importers['apps/api'].dependencies[alias] = { specifier, version: target };
  });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /confined to the reviewed apps\/mobile dependency graph/);
});
test('the fingerprint upstream parent cannot drift from the reviewed Expo55 version', () => {
  const graph = changeGraph(value => {
    const parent = Object.keys(value.snapshots).find(name => value.snapshots[name].dependencies?.['@expo/fingerprint']);
    value.snapshots[parent.replace('expo@55.0.0(', 'expo@55.0.1(')] = value.snapshots[parent];
    delete value.snapshots[parent];
  });
  assert.throws(() => check(workspace, readiness, { lockfile: graph }), /reviewed Expo55 fingerprint parent/);
});
for (const [id, error] of histories) test(`${id} preserves its complete historical decision and deadline`, () => {
  for (const field of ['Created on', 'Reviewed on', 'Owner decision on', 'Owner decision', 'Review by', 'Risk history', 'Runtime/build exposure', 'Temporarily accepted']) {
    const line = new RegExp(`(^- \\*\\*${field}:\\*\\* )[^\\n]+`, 'm');
    const altered = changeRecord(id, record => { assert.match(record, line); return record.replace(line, '$1UNAPPROVED'); });
    assert.throws(() => check(workspace, altered), error);
  }
  assert.throws(() => check(workspace, changeRecord(id, () => '')), error);
});
test('withdrawals require their authoritative reasons and dates', () => {
  for (const text of ['Retired on 2026-11-12 (Europe/Istanbul)', 'on 2026-10-23: not a practically exploitable vulnerability', 'on 2026-10-22: applications are responsible for handling exceptions appropriately']) {
    assert.throws(() => check(workspace, readiness.replace(text, 'missing')), /verified closure dates and reasons/);
  }
});
test('deepmerge retirement requires elimination of both installed consumers', () => {
  assert.throws(() => check(workspace, readiness.replace('Retired on 2026-11-12 after elimination from both @expo/config12.0.14 and55.0.21', 'One consumer only')), /both reviewed dependency eliminations/);
});
test('Forge retirement preserves its verified original patch and date', () => {
  for (const text of ['- **Retired on:** 2026-10-28.\n', '- **Patched package:** `node-forge@1.4.1`.\n']) {
    assert.throws(() => check(workspace, readiness.replace(text, 'missing')), /verified patch and retirement date/);
  }
});
