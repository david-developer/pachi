import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { parse, parseAllDocuments } from 'yaml';

export function validateDependencyAuditPolicy(workspace, readiness, options = {}) {
  const now = options.now ?? new Date();
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant) || instant < Date.parse('2026-11-13T00:00:00Z')) throw new Error('Minimatch acceptance assessment/decision cannot be in the future');
  if (instant >= Date.parse('2026-11-20T00:00:00Z')) throw new Error('Minimatch acceptance expired at 2026-11-20T00:00:00Z; no automatic renewal');
  if ((options.environment ?? process.env.NODE_ENV) === 'production') throw new Error('Minimatch acceptance is development/CI only; production deployment remains blocked');
  if (workspace.audit?.level !== 'low') throw new Error('Dependency audit threshold must remain low');
  if (Object.keys(workspace.audit).some((key) => !['level', 'ignore'].includes(key))) {
    throw new Error('Dependency audit error or finding suppression options are not approved');
  }
  const expectedAdvisories = ['GHSA-g3hv-75wg-m249', 'GHSA-c859-jr93-m5j4'];
  const ignored = workspace.audit?.ignore;
  if (!Array.isArray(ignored) || JSON.stringify(ignored) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Dependency audit exceptions must exactly match documented GHSA entries');
  }

  if (!readiness.includes('### Temporary dependency-audit exceptions\n')) {
    throw new Error('Dependency audit policy section must remain documented');
  }
  const section = readiness.split('### Temporary dependency-audit exceptions\n')[1].split('\n## ')[0];
  const records = [...section.matchAll(/^- \*\*Advisory:\*\* `([^`]+)`([\s\S]*?)(?=^- \*\*Advisory:\*\*|(?![\s\S]))/gm)];
  const documented = records.map((match) => match[1]);
  if (JSON.stringify(documented) !== JSON.stringify(expectedAdvisories)) {
    throw new Error('Documented dependency audit exceptions must exactly match workspace configuration');
  }

  // Pin the complete approved records, including original dates, controls and fixed expiry.
  const approvedHashes = ["93ad2c9ea5fad70089949f56c30178744e6c2f3c647a079f10afda9d29748095", "7d978d11c90427e719f9aff75ce23172ae258571adaebdfdfe33e1778cb69494"];
  for (const [index, match] of records.entries()) {
    const record = match[0].match(/^- \*\*Advisory:\*\* [\s\S]*?^- \*\*Temporarily accepted:\*\* [^\n]+/m)?.[0] ?? '';
    if (createHash('sha256').update(record.trim()).digest('hex') !== approvedHashes[index]) {
      throw new Error(`${expectedAdvisories[index]}: complete approved minimatch record, owner decision, controls and expiry must remain unchanged`);
    }
  }
  validateMinimatchAcceptanceGraph(options.lockfile ?? readFileSync('pnpm-lock.yaml', 'utf8'), workspace);

  // This retired acceptance is history, never an active audit capability.
  const retiredSection = readiness.split('## Retired dependency-audit exceptions\n')[1]?.split('\n## ')[0] ?? '';
  const historicalStart = retiredSection.indexOf('- **Advisory:** `GHSA-86w9-cpqp-85rv`');
  const historicalRecord = historicalStart === -1 ? '' : retiredSection.slice(historicalStart).trim();
  if (createHash('sha256').update(historicalRecord).digest('hex') !== '7a9c6e42d07b294020d5baf38603b2076490f7c6d23df59d3020f56f357dd84b') {
    throw new Error('Retired node-forge acceptance history and original decisions/dates must remain unchanged');
  }
  if (!retiredSection.includes('- **Retired on:** 2026-10-28.\n')
    || !retiredSection.includes('- **Patched package:** `node-forge@1.4.1`.\n')) {
    throw new Error('Retired node-forge exception must identify the verified patch and retirement date');
  }

  // Withdrawal closes only exact obsolete suppressions; original decisions remain immutable.
  const withdrawnSection = readiness.split('## Withdrawn dependency-audit exceptions\n')[1]?.split('\n## ')[0] ?? '';
  {
    const record = withdrawnSection.match(/- \*\*Advisory:\*\* `GHSA-vfj7-8cjw-p6xm`[\s\S]*?^- \*\*Temporarily accepted:\*\* [^\n]+/m)?.[0] ?? '';
    if (createHash('sha256').update(record).digest('hex') !== '2992761a148c04cd5d1c92691da9d3a7254d24018a5a18a84003d91c36edb074') {
      throw new Error('GHSA-vfj7-8cjw-p6xm: withdrawn advisory history and original decisions/deadline must remain unchanged');
    }
  }
  {
    const record = withdrawnSection.match(/- \*\*Advisory:\*\* `GHSA-hp3w-g68c-fv3c`[\s\S]*?^- \*\*Temporarily accepted:\*\* [^\n]+/m)?.[0] ?? '';
    if (createHash('sha256').update(record).digest('hex') !== 'f0c48962f0527845b0a5e17e1e48ae3bdf199049034cac494a99158001fcbc58') {
      throw new Error('GHSA-hp3w-g68c-fv3c: withdrawn advisory history and original decisions/deadline must remain unchanged');
    }
  }
  if (!withdrawnSection.includes('Retired on 2026-11-12 (Europe/Istanbul)')
    || !withdrawnSection.includes('on 2026-10-23: not a practically exploitable vulnerability')
    || !withdrawnSection.includes('on 2026-10-22: applications are responsible for handling exceptions appropriately')) {
    throw new Error('Withdrawn advisories must retain verified closure dates and reasons');
  }

  const deepmergeSection = readiness.split('## Retired deepmerge dependency-audit exception\n')[1]?.split('\n## ')[0] ?? '';
  const deepmergeRecord = deepmergeSection.match(/- \*\*Advisory:\*\* `GHSA-gcqx-w48m-w2h4`[\s\S]*?^- \*\*Temporarily accepted:\*\* [^\n]+/m)?.[0] ?? '';
  if (createHash('sha256').update(deepmergeRecord).digest('hex') !== 'aadef53cfaab0935640ec26aa70bde34f1ae47872d2025b16aca86fcdc1f4a37') {
    throw new Error('Retired deepmerge history and original November 4 expiry must remain unchanged');
  }
  if (!deepmergeSection.includes('Retired on 2026-11-12 after elimination from both @expo/config12.0.14 and55.0.21')) {
    throw new Error('Deepmerge retirement requires both reviewed dependency eliminations and retirement date');
  }
}

export function validateMinimatchAcceptanceGraph(lockfile, workspace) {
  const documents = typeof lockfile === 'string' ? parseAllDocuments(lockfile).map(d => d.toJSON()) : [lockfile];
  const project = documents.find(d => d?.importers?.['apps/mobile']);
  if (!project?.packages || !project.snapshots) throw new Error('Minimatch acceptance requires the complete project lockfile');
  const versions = Object.keys(project.packages).filter(k => k.startsWith('minimatch@')).sort();
  if (JSON.stringify(versions) !== JSON.stringify(['minimatch@10.2.6', 'minimatch@11.0.8', 'minimatch@3.1.5', 'minimatch@5.1.9'])) {
    throw new Error('Minimatch acceptance requires the exact reviewed versions; other affected versions are not accepted');
  }
  const patchHash = '6684dfa3d6a858fe96f009c11bc2fec259584013987338dd8f4b33f7689a0af6';
  if (project.patchedDependencies?.['@expo/fingerprint@0.16.5'] !== patchHash
    || workspace.patchedDependencies?.['@expo/fingerprint@0.16.5'] !== 'patches/@expo__fingerprint@0.16.5.patch') {
    throw new Error('Minimatch acceptance requires the reviewed fingerprint backport');
  }
  const expectedParent = `@expo/fingerprint@0.16.5(patch_hash=${patchHash})(supports-color@8.1.1)`;
  const parents = [];
  const isAffectedEdge = (name, value) => (name === 'minimatch' && value === '10.2.6')
    || (typeof value === 'string' && /^minimatch@10\.2\.6(?:$|\()/u.test(value));
  for (const [parent, snapshot] of Object.entries(project.snapshots)) {
    for (const kind of ['dependencies', 'optionalDependencies']) for (const [name, value] of Object.entries(snapshot[kind] ?? {})) {
      if (isAffectedEdge(name, value)) parents.push({ parent, kind, name });
    }
  }
  for (const importer of Object.values(project.importers)) for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(importer[kind] ?? {})) if (isAffectedEdge(name, value.version)) {
      throw new Error('Minimatch acceptance does not permit a direct application/importer dependency');
    }
  }
  if (JSON.stringify(parents) !== JSON.stringify([{ parent: expectedParent, kind: 'dependencies', name: 'minimatch' }])) {
    throw new Error('Minimatch acceptance permits only the exact fingerprint0.16.5 to minimatch10.2.6 edge');
  }
  const fingerprintParents = Object.entries(project.snapshots).filter(([, snapshot]) => snapshot.dependencies?.['@expo/fingerprint']);
  if (fingerprintParents.length !== 1 || !fingerprintParents[0][0].startsWith('expo@55.0.0(')
    || fingerprintParents[0][1].dependencies['@expo/fingerprint'] !== `0.16.5(patch_hash=${patchHash})(supports-color@8.1.1)`) {
    throw new Error('Minimatch acceptance requires the reviewed Expo55 fingerprint parent');
  }
  // An unchanged shared snapshot must not silently make the exception usable
  // from a server, worker or another workspace importer.
  const reachesAcceptedMatcher = rootImporter => {
    const pending = [{ importer: rootImporter }];
    const visited = new Set();
    for (let index = 0; index < pending.length; index++) {
      const entry = pending[index];
      const key = entry.importer ? `workspace:${entry.importer}` : entry.package;
      if (visited.has(key)) continue;
      visited.add(key);
      if (entry.package === 'minimatch@10.2.6') return true;
      const source = entry.importer ? project.importers[entry.importer] : project.snapshots[entry.package];
      const kinds = entry.importer ? ['dependencies', 'devDependencies', 'optionalDependencies'] : ['dependencies', 'optionalDependencies'];
      for (const kind of kinds) for (const [name, value] of Object.entries(source?.[kind] ?? {})) {
        const version = entry.importer ? value.version : value;
        if (typeof version !== 'string') throw new Error('Minimatch acceptance requires resolved dependency versions');
        if (version.startsWith('link:')) {
          if (!entry.importer) throw new Error('Minimatch acceptance requires reviewed workspace links');
          const target = posix.normalize(posix.join(entry.importer, version.slice(5)));
          if (!project.importers[target]) throw new Error('Minimatch acceptance requires reviewed workspace links');
          pending.push({ importer: target });
        } else {
          // pnpm aliases carry a complete canonical snapshot key as the
          // resolution, rather than a version relative to the alias name.
          const target = project.snapshots[version] ? version : `${name}@${version}`;
          if (!project.snapshots[target]) throw new Error('Minimatch acceptance requires the complete resolved dependency graph');
          pending.push({ package: target });
        }
      }
    }
    return false;
  };
  for (const name of Object.keys(project.importers)) {
    if (reachesAcceptedMatcher(name) !== (name === 'apps/mobile')) {
      throw new Error('Minimatch acceptance is confined to the reviewed apps/mobile dependency graph');
    }
  }
}

if (process.argv[1]?.endsWith('check-dependency-audit-policy.mjs')) {
  const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
  const readiness = readFileSync('docs/03-operations/production-readiness-checklist.md', 'utf8');
  validateDependencyAuditPolicy(workspace, readiness, { environment: process.argv.includes('--production') ? 'production' : process.env.NODE_ENV });
  console.log('Dependency audit policy valid: low threshold; exact minimatch fingerprint development/CI acceptance expires 2026-11-20T00:00:00Z; production blocked; historical records preserved');
}
