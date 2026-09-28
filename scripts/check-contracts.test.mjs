import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';

test('contract check rejects missing routes and incompatible shared response shapes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pachi-contract-negative-'));
  try {
    for (const mutation of [
      d => { delete d.paths['/v1/staff/session']; },
      d => { d.components.schemas.StaffSession.properties.display_name.type = 'integer'; },
      d => { d.components.schemas.ListingDraftResponse.required = []; },
    ]) {
      const doc = parse(readFileSync('apps/api/openapi.yaml', 'utf8')); mutation(doc);
      const path = join(directory, 'bad.yaml'); writeFileSync(path, stringify(doc));
      const result = spawnSync(process.execPath, ['scripts/check-contracts.mjs', path], {encoding:'utf8'});
      assert.equal(result.status, 1);
      assert.match(result.stderr, /contract drift/);
    }
  } finally { rmSync(directory, {recursive:true, force:true}); }
});
