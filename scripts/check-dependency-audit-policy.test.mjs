import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { validateDependencyAuditPolicy } from './check-dependency-audit-policy.mjs';

const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');

test('dependency audit policy accepts the exact documented temporary advisory', () => {
  assert.doesNotThrow(() => validateDependencyAuditPolicy(workspace, readiness, '2026-10-02'));
});

test('dependency audit policy rejects a changed threshold or extra ignored advisory', () => {
  assert.throws(() => validateDependencyAuditPolicy({...workspace,audit:{...workspace.audit,level:'moderate'}},readiness,'2026-10-02'), /threshold must remain low/);
  assert.throws(() => validateDependencyAuditPolicy({...workspace,audit:{...workspace.audit,ignore:[...workspace.audit.ignore,'GHSA-unreviewed']}},readiness,'2026-10-02'), /exactly match documented/);
});

test('dependency audit policy rejects undocumented, incomplete, or overdue exceptions', () => {
  assert.throws(() => validateDependencyAuditPolicy(workspace,readiness.replace('Review by:** 2026-10-16','Review date missing'),'2026-10-02'), /metadata is missing/);
  assert.throws(() => validateDependencyAuditPolicy(workspace,readiness.replace('GHSA-86w9-cpqp-85rv','GHSA-unreviewed'),'2026-10-02'), /exactly match/);
  assert.throws(() => validateDependencyAuditPolicy(workspace,readiness,'2026-10-17'), /overdue/);
});
