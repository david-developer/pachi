import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { validateDependencyAuditPolicy } from './check-dependency-audit-policy.mjs';

const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
const today = '2026-10-06';
const exceptions = [
  { ghsa: 'GHSA-86w9-cpqp-85rv', reviewBy: '2026-10-16', overlong: '2026-10-20', changed: '2026-10-15' },
  { ghsa: 'GHSA-vfj7-8cjw-p6xm', reviewBy: '2026-10-16', overlong: '2026-10-20', changed: '2026-10-15' },
  { ghsa: 'GHSA-hp3w-g68c-fv3c', reviewBy: '2026-10-13', overlong: '2026-10-21', changed: '2026-10-12' },
];
const advisories = exceptions.map(({ ghsa }) => ghsa);
const validate = (config = workspace, document = readiness) => validateDependencyAuditPolicy(config, document, today);
const audit = (changes) => ({ ...workspace, audit: { ...workspace.audit, ...changes } });
function changeRecord(ghsa, change) {
  const start = readiness.indexOf(`- **Advisory:** \`${ghsa}\``);
  const next = readiness.indexOf('- **Advisory:**', start + 1);
  const end = next === -1 ? readiness.indexOf('\n## Gate summary', start) : next;
  return readiness.slice(0, start) + change(readiness.slice(start, end)) + readiness.slice(end);
}

test('exact three-advisory documented policy passes', () => {
  assert.doesNotThrow(() => validate());
});

test('changing the threshold away from low fails', () => {
  assert.throws(() => validate(audit({ level: 'moderate' })), /threshold must remain low/);
});

test('adding a fourth configured GHSA fails', () => {
  assert.throws(() => validate(audit({ ignore: [...advisories, 'GHSA-unreviewed'] })), /exactly match/);
});

test('undocumented configured GHSA fails', () => {
  assert.throws(() => validate(audit({ ignore: [advisories[0], advisories[1], 'GHSA-unreviewed'] })), /exactly match/);
});

test('documented but unconfigured GHSA fails', () => {
  const extra = readiness.replace('\n## Gate summary', '\n- **Advisory:** `GHSA-unreviewed`\n\n## Gate summary');
  assert.throws(() => validate(workspace, extra), /exactly match workspace/);
});

test('exception ordering and duplicate exceptions fail', () => {
  assert.throws(() => validate(audit({ ignore: [...advisories].reverse() })), /exactly match/);
  assert.throws(() => validate(audit({ ignore: [advisories[0], advisories[0], advisories[2]] })), /exactly match/);
  assert.throws(() => validate(workspace, readiness.replace(advisories[1], advisories[0])), /exactly match workspace/);
});

for (const { ghsa, reviewBy, overlong, changed } of exceptions) {
  test(`removing configured or documented ${ghsa} fails`, () => {
    assert.throws(() => validate(audit({ ignore: advisories.filter((id) => id !== ghsa) })), /exactly match/);
    assert.throws(() => validate(workspace, changeRecord(ghsa, () => '')), /exactly match workspace/);
  });

  test(`missing or empty metadata in ${ghsa} fails independently`, () => {
    for (const field of ['CVE', 'Package', 'Provenance', 'Runtime/build exposure', 'Reason', 'Compensating controls', 'Owner', 'Review by', 'Removal trigger']) {
      const line = new RegExp(`^- \\*\\*${field}:\\*\\* [^\\n]+`, 'm');
      for (const replacement of ['', `- **${field}:** `]) {
        assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(line, replacement))), /metadata is missing/);
      }
    }
  });

  test(`wrong CVE or package/version in ${ghsa} fails`, () => {
    for (const field of ['CVE', 'Package']) {
      assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(new RegExp(`^- \\*\\*${field}:\\*\\* [^\\n]+`, 'm'), `- **${field}:** \`wrong\``))), /must match approved/);
    }
  });

  test(`overdue ${ghsa} fails while the other record is valid`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, 'Review by:** 2026-10-05'))), /review date is overdue/);
  });

  test(`review window over 14 days in ${ghsa} fails`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, `Review by:** ${overlong}`))), /exceeds 14 days/);
  });

  test(`invalid or changed approved deadline in ${ghsa} fails`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, 'Review by:** 2026-02-30'))), /valid ISO date/);
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, `Review by:** ${changed}`))), /approved deadline/);
  });
}

test('the review deadline day itself is blocked', () => {
  assert.throws(() => validateDependencyAuditPolicy(workspace, readiness, '2026-10-16'), /overdue/);
});

test('sprintf-js earlier deadline day itself is blocked independently', () => {
  assert.doesNotThrow(() => validateDependencyAuditPolicy(workspace, readiness, '2026-10-12'));
  assert.throws(() => validateDependencyAuditPolicy(workspace, readiness, '2026-10-13'), /GHSA-hp3w-g68c-fv3c: temporary audit exception review date is overdue/);
});

test('metadata outside the exception section cannot satisfy the guard', () => {
  assert.throws(() => validate(workspace, readiness.replace('### Temporary dependency-audit exceptions', '### Moved exceptions')), /exactly match workspace/);
});
