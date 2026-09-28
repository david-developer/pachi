import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { parse } from 'yaml';
import openapiTS, { astToString } from 'openapi-typescript';

const journal = JSON.parse(readFileSync('packages/database/migrations/meta/_journal.json', 'utf8')).entries;
const sqlFiles = readdirSync('packages/database/migrations').filter(f => f.endsWith('.sql')).sort();
if (JSON.stringify(sqlFiles) !== JSON.stringify(journal.map(e => `${e.tag}.sql`).sort()) ||
    journal.some((e, i) => e.idx !== i || (i > 0 && e.when <= journal[i-1].when))) {
  throw Error('Migration journal/file order drift');
}

const document = parse(readFileSync(process.argv[2] ?? 'apps/api/openapi.yaml', 'utf8'));
const methods = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);
const actual = new Set();
const decorators = (node) => (ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []).map(d => d.expression).filter(ts.isCallExpression);
for (const file of readdirSync('apps/api/src').filter(f => f.endsWith('.ts') && !f.includes('.test.'))) {
  const source = ts.createSourceFile(file, readFileSync(`apps/api/src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const node of source.statements.filter(ts.isClassDeclaration)) {
    const controller = decorators(node).find(d => d.expression.getText(source) === 'Controller');
    if (!controller) continue;
    const prefix = controller.arguments[0]?.text ?? '';
    for (const member of node.members) for (const d of decorators(member)) {
      const method = d.expression.getText(source);
      if (!methods.has(method)) continue;
      const path = `/v1/${prefix}/${d.arguments[0]?.text ?? ''}`.replace(/\/$/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      actual.add(`${method.toLowerCase()} ${path}`);
    }
  }
}
const declared = new Set(Object.entries(document.paths).flatMap(([path, item]) => Object.keys(item).filter(m => methods.has(m[0].toUpperCase()+m.slice(1))).map(m => `${m} ${path}`)));
for (const route of new Set([...actual, ...declared])) if (actual.has(route) !== declared.has(route)) throw Error(`Route contract drift: ${route}`);
const aliases = { StaffSession:'StaffSessionResponse', Participation:'ParticipationProjection', BootstrapResponse:'AuthBootstrapResponse', AccountResponse:'AccountMeResponse', ProviderOverviewResponse:'ProviderOnboardingResponse', ListingReadinessCheck:'ListingReadinessCheckResponse' };
const noSharedType = new Set(['BootstrapRequest']); // Inline controller input; no exported shared DTO.
const directory = mkdtempSync(join(tmpdir(), 'pachi-contracts-'));
try {
  writeFileSync(join(directory, 'openapi.ts'), astToString(await openapiTS(document)));
  const pairs = Object.keys(document.components.schemas).filter(n => !noSharedType.has(n));
  writeFileSync(join(directory, 'compare.ts'), `import type { components } from './openapi';\nimport type * as C from '${resolve('packages/contracts/src/index.js')}';\ntype Assert<T extends true> = T;\ntype Normalize<T> = T extends object ? { [K in keyof T]: Normalize<T[K]> } : T;\ntype Same<A,B> = (<T>() => T extends Normalize<A> ? 1 : 2) extends (<T>() => T extends Normalize<B> ? 1 : 2) ? true : false;\n` + pairs.map(n => `type Check${n} = Assert<Same<components['schemas']['${n}'], C.${aliases[n] ?? n}>>;`).join('\n'));
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--target','ES2022','--moduleResolution','bundler','--module','ESNext',join(directory,'compare.ts')], {encoding:'utf8'});
  if (result.status !== 0) { process.stderr.write(result.stdout + result.stderr); throw Error('OpenAPI/shared TypeScript contract drift'); }
  console.log(`Contract consistency passed: ${actual.size} routes and ${pairs.length} shared schemas`);
} finally { rmSync(directory, {recursive:true,force:true}); }
