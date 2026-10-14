import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const expectedExceptions = [
  {
    ghsa: 'GHSA-86w9-cpqp-85rv',
    cve: 'CVE-2026-85393',
    package: 'node-forge@1.4.0',
    createdOn: '2026-10-02',
    reviewedOn: '2026-10-14',
    decisionOn: '2026-10-14',
    reviewBy: '2026-11-13',
  },
  {
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    cve: 'CVE-2026-93687',
    package: 'braces@3.0.3',
    createdOn: '2026-10-05',
    reviewedOn: '2026-10-14',
    decisionOn: '2026-10-14',
    reviewBy: '2026-11-13',
  },
  {
    ghsa: 'GHSA-hp3w-g68c-fv3c',
    cve: 'CVE-2026-97058',
    package: 'sprintf-js@1.0.3',
    createdOn: '2026-10-06',
    reviewedOn: '2026-10-14',
    decisionOn: '2026-10-14',
    reviewBy: '2026-11-13',
  },
];
const requiredFields = [
  'CVE', 'Package', 'Provenance', 'Runtime/build exposure', 'Reason',
  'Compensating controls', 'Owner', 'Created on', 'Reviewed on',
  'Owner decision on', 'Owner decision', 'Risk history', 'Review by', 'Removal trigger',
  'Vulnerability fixed', 'Temporarily accepted',
];
const approvedDecision = 'ACCEPTED ONCE for development/CI only; no automatic extension or production deployment approval.';
const dayMs = 24 * 60 * 60 * 1000;

function dateValue(value) {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error('Temporary audit exception date must be a valid ISO date');
  }
  return time;
}

export function validateDependencyAuditPolicy(workspace, readiness, today = new Date().toISOString().slice(0, 10)) {
  if (workspace.audit?.level !== 'low') throw new Error('Dependency audit threshold must remain low');
  if (Object.keys(workspace.audit).some((key) => !['level', 'ignore'].includes(key))) {
    throw new Error('Dependency audit error or finding suppression options are not approved');
  }
  const expectedAdvisories = expectedExceptions.map(({ ghsa }) => ghsa);
  const ignored = workspace.audit?.ignore;
  if (!Array.isArray(ignored) || JSON.stringify(ignored) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Dependency audit exceptions must exactly match documented GHSA entries');
  }

  const section = readiness.split('### Temporary dependency-audit exceptions\n')[1]?.split('\n## ')[0] ?? '';
  const records = [...section.matchAll(/^- \*\*Advisory:\*\* `([^`]+)`([\s\S]*?)(?=^- \*\*Advisory:\*\*|(?![\s\S]))/gm)];
  const documented = records.map((match) => match[1]);
  if (JSON.stringify(documented) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Documented dependency audit exceptions must exactly match workspace configuration');
  }

  const todayTime = dateValue(today);
  for (const [index, exception] of expectedExceptions.entries()) {
    const record = records[index][0];
    const entries = [...record.matchAll(/^- \*\*([^*]+):\*\* ([^\n]+)$/gm)].map((match) => [match[1], match[2].trim()]);
    const fields = new Map(entries);
    if (fields.size !== entries.length) throw new Error(`${exception.ghsa}: duplicate exception metadata is not approved`);
    for (const field of requiredFields) {
      if (!fields.get(field)) throw new Error(`${exception.ghsa}: temporary audit exception metadata is missing ${field}`);
    }
    if (fields.get('CVE').split('`')[1] !== exception.cve || fields.get('Package').split('`')[1] !== exception.package) {
      throw new Error(`${exception.ghsa}: temporary audit exception metadata must match approved CVE and package/version`);
    }
    if (fields.get('Vulnerability fixed') !== 'NO.' || !fields.get('Temporarily accepted').startsWith('YES')) {
      throw new Error(`${exception.ghsa}: accepted vulnerability must remain explicitly unfixed`);
    }
    const createdOn = fields.get('Created on').replace(/\.$/, '');
    const createdTime = dateValue(createdOn);
    if (createdOn !== exception.createdOn) throw new Error(`${exception.ghsa}: original creation date must remain unchanged`);
    const reviewedOn = fields.get('Reviewed on').replace(/\.$/, '');
    const reviewedTime = dateValue(reviewedOn);
    if (reviewedTime < createdTime || reviewedTime > todayTime) {
      throw new Error(`${exception.ghsa}: assessment date must follow creation and cannot be in the future`);
    }
    if (reviewedOn !== exception.reviewedOn) throw new Error(`${exception.ghsa}: assessment date must match the approved one-time review`);
    const decisionOn = fields.get('Owner decision on').replace(/\.$/, '');
    const decisionTime = dateValue(decisionOn);
    if (decisionTime < reviewedTime || decisionTime > todayTime || decisionOn !== exception.decisionOn || fields.get('Owner decision') !== approvedDecision) {
      throw new Error(`${exception.ghsa}: owner decision must match the approved one-time development/CI acceptance`);
    }
    const reviewBy = fields.get('Review by').replace(/\.$/, '');
    const reviewTime = dateValue(reviewBy);
    if (reviewTime <= todayTime || reviewTime > reviewedTime + 30 * dayMs) {
      throw new Error(`${exception.ghsa}: temporary audit exception review date is overdue or exceeds 30 days from assessment`);
    }
    if (reviewBy !== exception.reviewBy) throw new Error(`${exception.ghsa}: review date must match approved deadline`);
  }
}

if (process.argv[1]?.endsWith('check-dependency-audit-policy.mjs')) {
  const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
  const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
  validateDependencyAuditPolicy(workspace, readiness);
  console.log('Dependency audit policy valid: low threshold; three documented, time-bounded GHSA exceptions');
}
