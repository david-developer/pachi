import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const expectedExceptions = [
  {
    ghsa: 'GHSA-86w9-cpqp-85rv',
    cve: 'CVE-2026-85393',
    package: 'node-forge@1.4.0',
    createdOn: '2026-10-02',
    reviewBy: '2026-10-16',
  },
  {
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    cve: 'CVE-2026-93687',
    package: 'braces@3.0.3',
    createdOn: '2026-10-05',
    reviewBy: '2026-10-16',
  },
];
const requiredFields = [
  'CVE', 'Package', 'Provenance', 'Runtime/build exposure', 'Reason',
  'Compensating controls', 'Owner', 'Review by', 'Removal trigger',
];
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
    const fields = new Map([...record.matchAll(/^- \*\*([^*]+):\*\* ([^\n]+)$/gm)].map((match) => [match[1], match[2].trim()]));
    for (const field of requiredFields) {
      if (!fields.get(field)) throw new Error(`${exception.ghsa}: temporary audit exception metadata is missing ${field}`);
    }
    if (fields.get('CVE').split('`')[1] !== exception.cve || fields.get('Package').split('`')[1] !== exception.package) {
      throw new Error(`${exception.ghsa}: temporary audit exception metadata must match approved CVE and package/version`);
    }
    const reviewBy = fields.get('Review by').replace(/\.$/, '');
    const reviewTime = dateValue(reviewBy);
    if (reviewTime <= todayTime || reviewTime > dateValue(exception.createdOn) + 14 * dayMs) {
      throw new Error(`${exception.ghsa}: temporary audit exception review date is overdue or exceeds 14 days`);
    }
    if (reviewBy !== exception.reviewBy) throw new Error(`${exception.ghsa}: review date must match approved deadline`);
  }
}

if (process.argv[1]?.endsWith('check-dependency-audit-policy.mjs')) {
  const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
  const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
  validateDependencyAuditPolicy(workspace, readiness);
  console.log('Dependency audit policy valid: low threshold; two documented, time-bounded GHSA exceptions');
}
