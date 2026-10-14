import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { validateDependencyAuditPolicy } from './check-dependency-audit-policy.mjs';

const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
const today = '2026-10-14';
const exceptions = [
  { ghsa: 'GHSA-86w9-cpqp-85rv', createdOn: '2026-10-02' },
  { ghsa: 'GHSA-vfj7-8cjw-p6xm', createdOn: '2026-10-05' },
  { ghsa: 'GHSA-hp3w-g68c-fv3c', createdOn: '2026-10-06' },
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

for (const { ghsa, createdOn } of exceptions) {
  const reviewBy = '2026-11-13';
  const overlong = '2026-11-14';
  const changed = '2026-11-12';
  test(`removing configured or documented ${ghsa} fails`, () => {
    assert.throws(() => validate(audit({ ignore: advisories.filter((id) => id !== ghsa) })), /exactly match/);
    assert.throws(() => validate(workspace, changeRecord(ghsa, () => '')), /exactly match workspace/);
  });

  test(`missing or empty metadata in ${ghsa} fails independently`, () => {
    for (const field of ['CVE', 'Package', 'Provenance', 'Runtime/build exposure', 'Reason', 'Compensating controls', 'Owner', 'Created on', 'Reviewed on', 'Owner decision on', 'Owner decision', 'Risk history', 'Review by', 'Removal trigger', 'Vulnerability fixed', 'Temporarily accepted']) {
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

  test(`review window over 30 days from assessment in ${ghsa} fails`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, `Review by:** ${overlong}`))), /exceeds 30 days from assessment/);
  });

  test(`invalid or changed approved deadline in ${ghsa} fails`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, 'Review by:** 2026-02-30'))), /valid ISO date/);
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Review by:** ${reviewBy}`, `Review by:** ${changed}`))), /approved deadline/);
  });
}

for (const date of ['2026-10-14', '2026-10-16', '2026-11-12']) {
  test(`one-time acceptance permits ${date}`, () => {
    assert.doesNotThrow(() => validateDependencyAuditPolicy(workspace, readiness, date));
  });
}

for (const date of ['2026-11-13', '2026-11-14']) {
  test(`expired review exceptions block ${date}`, () => {
    assert.throws(() => validateDependencyAuditPolicy(workspace, readiness, date), /temporary audit exception review date is overdue/);
  });
}

for (const { ghsa, createdOn } of exceptions) {
  test(`original ${ghsa} creation history cannot be reset`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace(`Created on:** ${createdOn}`, 'Created on:** 2026-10-14'))), /original creation date must remain unchanged/);
  });

  test(`${ghsa} assessment rejects invalid, pre-creation, future and unapproved dates`, () => {
    for (const [date, error] of [['2026-02-30', /valid ISO date/], ['2026-10-01', /assessment date must follow creation/], ['2026-10-15', /cannot be in the future/], ['2026-10-13', /approved one-time review/]]) {
      assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('Reviewed on:** 2026-10-14', `Reviewed on:** ${date}`))), error);
    }
  });

  test(`${ghsa} owner decision date and development/CI scope are pinned independently`, () => {
    for (const date of ['2026-10-13', '2026-10-15']) {
      assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('Owner decision on:** 2026-10-14', `Owner decision on:** ${date}`))), /owner decision must match/);
    }
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('development/CI only', 'production'))), /owner decision must match/);
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('no automatic extension', 'automatic extension'))), /owner decision must match/);
  });

  test(`${ghsa} cannot be classified as fixed`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('Vulnerability fixed:** NO.', 'Vulnerability fixed:** YES.'))), /explicitly unfixed/);
  });

  test(`${ghsa} cannot reset assessment and deadline together to gain another window`, () => {
    const document = changeRecord(ghsa, (record) => record.replace('Reviewed on:** 2026-10-14', 'Reviewed on:** 2026-10-15').replace('Owner decision on:** 2026-10-14', 'Owner decision on:** 2026-10-15').replace('Review by:** 2026-11-13', 'Review by:** 2026-11-14'));
    assert.throws(() => validateDependencyAuditPolicy(workspace, document, '2026-10-15'), /approved one-time review/);
  });

  test(`${ghsa} duplicate metadata cannot conceal a different deadline`, () => {
    assert.throws(() => validate(workspace, changeRecord(ghsa, (record) => record.replace('Review by:** 2026-11-13.', 'Review by:** 2026-11-14.\n- **Review by:** 2026-11-13.'))), /duplicate exception metadata/);
  });
}

test('acceptance cannot be used before its fresh assessment', () => {
  assert.throws(() => validateDependencyAuditPolicy(workspace, readiness, '2026-10-13'), /cannot be in the future/);
});

test('audit error and unfixable-finding suppression options are rejected', () => {
  for (const key of ['ignoreRegistryErrors', 'ignoreUnfixable', 'ignore-unfixable']) {
    assert.throws(() => validate(audit({ [key]: true })), /suppression options are not approved/);
  }
});

test('metadata outside the exception section cannot satisfy the guard', () => {
  assert.throws(() => validate(workspace, readiness.replace('### Temporary dependency-audit exceptions', '### Moved exceptions')), /exactly match workspace/);
});
