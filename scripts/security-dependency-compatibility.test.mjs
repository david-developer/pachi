import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('source-map reconstruction tolerates an indexed offset beyond generated input without an unbounded loop', () => {
  const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const next = createRequire(web.resolve('next/package.json'));
  const postcss = createRequire(next.resolve('postcss/package.json'));
  const sourceMapPath = postcss.resolve('source-map-js');
  // A separate bounded process also fails safely if a future resolution brings
  // back the old synchronous loop; no large input or unbounded test process.
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const { SourceMapConsumer, SourceNode } = require(${JSON.stringify(sourceMapPath)});
    const assert = require('node:assert/strict');
    const section = line => ({ version: 3, sections: [{ offset: { line, column: 0 },
      map: { version: 3, sources: ['synthetic.js'], sourcesContent: ['x'], names: [], mappings: 'AAAA' } }] });
    assert.throws(() => new SourceMapConsumer(section(1000000000)), /offset line must not exceed/);
    const map = new SourceMapConsumer(section(10000000));
    process.stdout.write(SourceNode.fromStringWithSourceMap('x\\n', map).toString());
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'x\n');
});
