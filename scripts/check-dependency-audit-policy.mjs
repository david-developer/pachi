import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const expectedAdvisories = ['GHSA-86w9-cpqp-85rv'];
const reviewBy = '2026-10-16';

export function validateDependencyAuditPolicy(workspace, readiness, today = new Date().toISOString().slice(0, 10)) {
  if (workspace.audit?.level !== 'low') throw new Error('Dependency audit threshold must remain low');
  const ignored = workspace.audit?.ignore;
  if (!Array.isArray(ignored) || JSON.stringify(ignored) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Dependency audit exceptions must exactly match documented GHSA entries');
  }

  const documented = [...readiness.matchAll(/^- \*\*Advisory:\*\* `([^`]+)`/gm)].map((match) => match[1]);
  if (JSON.stringify(documented) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Documented dependency audit exceptions must exactly match workspace configuration');
  }
  const section = readiness.split('### Temporary dependency-audit exceptions\n')[1]?.split('\n## ')[0] ?? '';
  for (const field of [
    'CVE-2026-85393',
    'node-forge@1.4.0',
    'Provenance:',
    'Runtime/build exposure:',
    'Reason:',
    'Compensating controls:',
    'Owner:',
    `Review by:** ${reviewBy}`,
    'Removal trigger:',
  ]) {
    if (!section.includes(field)) throw new Error(`Temporary audit exception metadata is missing ${field}`);
  }

  const reviewDate = new Date(`${reviewBy}T00:00:00Z`);
  const createdDate = new Date('2026-10-02T00:00:00Z');
  const maxReviewDate = new Date(createdDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (reviewDate <= new Date(`${today}T00:00:00Z`) || reviewDate > maxReviewDate) {
    throw new Error('Temporary audit exception review date is overdue or exceeds 14 days');
  }
}

if (process.argv[1]?.endsWith('check-dependency-audit-policy.mjs')) {
  const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
  const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
  validateDependencyAuditPolicy(workspace, readiness);
  console.log('Dependency audit policy valid: low threshold; one documented, time-bounded GHSA exception');
}
