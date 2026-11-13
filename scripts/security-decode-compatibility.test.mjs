import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';

function consumers() {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const router = createRequire(mobile.resolve('expo-router/package.json'));
  return { router, query: createRequire(router.resolve('query-string/package.json')) };
}

test('Expo Router keeps its query-string consumer and only the authenticated decoder patch', () => {
  const { router, query } = consumers();
  assert.equal(router('./package.json').version, '6.0.0');
  assert.equal(query('./package.json').version, '7.1.3');
  assert.equal(JSON.parse(readFileSync(join(dirname(query.resolve('decode-uri-component')), 'package.json'), 'utf8')).version, '0.5.1');
  const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.ok(documents.every(document => document.errors.length === 0));
  const packages = Object.assign({}, ...documents.map(document => document.toJSON().packages ?? {}));
  assert.deepEqual(Object.keys(packages).filter(name => name.startsWith('decode-uri-component@')), ['decode-uri-component@0.5.1']);
  assert.equal(packages['decode-uri-component@0.5.1'].resolution.integrity,
    'sha512-vWHQkXgg2cE3BB4rR0c+PYw9BCQzLoNIRMI7AunIkZst74tw/vpPp7VLoYtsR/cy1f55g3XDWUslfeCZjiZJyA==');
});

test('actual query-string parsing preserves malformed escapes Unicode arrays and prototype isolation', () => {
  const { router } = consumers();
  const query = router('query-string');
  const parsed = query.parse('city=Douala&bad=%C3%28&plus=a+b&encoded=%2525&room=1&room=2&name=%E4%BD%A0%E5%A5%BD&__proto__=synthetic');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.city, 'Douala');
  assert.equal(parsed.bad, '%C3(');
  assert.equal(parsed.plus, 'a b');
  assert.equal(parsed.encoded, '%25');
  assert.equal(parsed.name, '你好');
  assert.deepEqual(parsed.room, ['1', '2']);
  assert.equal(parsed.__proto__, 'synthetic');
  assert.equal(Object.prototype.synthetic, undefined);
  const expected = { ...parsed };
  delete expected.__proto__;
  assert.deepEqual({ ...query.parse(query.stringify(parsed)) }, expected);
});

test('malformed percent runs complete safely in a bounded child and retain upstream decoding behavior', () => {
  const path = consumers().query.resolve('decode-uri-component');
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const assert = require('node:assert/strict');
    const decode = require(${JSON.stringify(path)}).default;
    for (const [input, expected] of [
      ['%', '%'], ['%ab', '%ab'], ['%C2', '\\uFFFD'],
      ['%FE%FF', '\\uFFFD\\uFFFD'], ['%C3%5A%A5', '%C3Z%A5'],
      ['st%C3%A5le%', 'ståle%'], ['%F0%9F%98%80', '😀'],
      ['%2525', '%25'], ['%C0%AF', '%C0%AF'],
    ]) assert.equal(decode(input), expected);
    // Fixed 12 KiB input, never an unbounded DoS reproduction.
    assert.equal(decode('%FF%41'.repeat(2048)), '%FFA'.repeat(2048));
    assert.throws(() => decode(null), TypeError);
  `], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
