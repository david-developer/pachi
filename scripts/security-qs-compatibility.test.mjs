import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';

function consumers() {
  const api = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const platform = createRequire(api.resolve('@nestjs/platform-express/package.json'));
  const express = createRequire(platform.resolve('express/package.json'));
  return { express, body: createRequire(express.resolve('body-parser/package.json')) };
}

test('Express and body-parser share the released qs patch with no vulnerable lock resolution', () => {
  const { express, body } = consumers();
  assert.equal(express('./package.json').version, '5.2.1');
  assert.equal(body('./package.json').version, '2.4.0');
  for (const consumer of [express, body]) assert.equal(consumer('qs/package.json').version, '6.16.2');
  assert.equal(express.resolve('qs'), body.resolve('qs'));
  const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.ok(documents.every((document) => document.errors.length === 0));
  const resolutions = documents.flatMap((document) => Object.keys(document.toJSON().packages ?? {}))
    .filter((name) => name.startsWith('qs@'));
  assert.deepEqual(resolutions, ['qs@6.16.2']);
});

test('actual Express extended query parsing preserves nested data and safe object coercion', () => {
  const { express } = consumers();
  const parseQuery = express('./lib/utils.js').compileQueryParser('extended');
  assert.deepEqual(parseQuery('filter[city]=Douala&rooms[]=1&rooms[]=2'), {
    filter: { city: 'Douala' }, rooms: ['1', '2'],
  });
  const parsed = parseQuery('a[0][toString]=synthetic');
  assert.equal(Object.hasOwn(parsed.a[0], 'toString'), true);
  assert.equal(express('qs').stringify(parsed, { arrayFormat: 'comma' }), 'a=%5Bobject%20Object%5D');
  assert.equal(Object.prototype.synthetic, undefined);
});

test('qs comma serialization safely handles the advisory object shapes in a bounded child', () => {
  const qsPath = consumers().express.resolve('qs');
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const assert = require('node:assert/strict');
    const qs = require(${JSON.stringify(qsPath)});
    for (const encodeValuesOnly of [false, true]) {
      for (const value of [{ toString: 'synthetic' }, Object.create(null), { valueOf: null, toString: null }]) {
        const result = qs.stringify({ a: [value] }, { arrayFormat: 'comma', encodeValuesOnly });
        assert.equal(result, 'a=%5Bobject%20Object%5D');
      }
      assert.equal(qs.stringify({ a: ['one', 'two'] }, { arrayFormat: 'comma', encodeValuesOnly }),
        encodeValuesOnly ? 'a=one,two' : 'a=one%2Ctwo');
    }
    assert.equal(qs.stringify({ a: ['one', 'two'] }), 'a%5B0%5D=one&a%5B1%5D=two');
  `], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('qs allowEmptyArrays encodes literal keys without query injection in a bounded child', () => {
  const qsPath = consumers().express.resolve('qs');
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const assert = require('node:assert/strict');
    const qs = require(${JSON.stringify(qsPath)});
    for (const delimiter of ['&', ';']) {
      for (const key of ['x&injected=value', 'x;injected=value', 'x=value', 'x#fragment']) {
        for (const arrayFormat of ['indices', 'brackets', 'repeat', 'comma']) {
          const options = { allowEmptyArrays: true, delimiter, arrayFormat };
          const query = qs.stringify({ q: 'hi', [key]: [] }, options);
          assert.equal(query.includes('#'), false);
          assert.deepEqual(qs.parse(query, { allowEmptyArrays: true, delimiter }), { q: 'hi', [key]: [] });
          assert.deepEqual(qs.parse(qs.stringify({ parent: { [key]: [] } }, options), {
            allowEmptyArrays: true, delimiter,
          }), { parent: { [key]: [] } });
        }
      }
    }
    assert.equal(qs.stringify({ plain: [] }, { allowEmptyArrays: true }), 'plain[]');
    assert.equal(qs.stringify({ parent: { plain: [] } }, { allowEmptyArrays: true }), 'parent%5Bplain%5D[]');
    assert.equal(qs.stringify({ 'a b': [] }, { allowEmptyArrays: true }), 'a%20b[]');
    assert.equal(qs.stringify({ 'a b': [] }, { allowEmptyArrays: true, format: 'RFC1738' }), 'a+b[]');
    const calls = [];
    const query = qs.stringify({ 'x&injected=value': [] }, {
      allowEmptyArrays: true,
      encoder(value, defaultEncoder, charset, type, format) {
        calls.push({ value, type });
        return defaultEncoder(value, defaultEncoder, charset, type, format);
      },
    });
    assert.equal(query, 'x%26injected%3Dvalue[]');
    assert.deepEqual(calls, [{ value: 'x&injected=value', type: 'key' }]);
    // These explicitly unencoded modes intentionally preserve the caller's raw key.
    for (const options of [{ encode: false }, { encodeValuesOnly: true }]) {
      assert.equal(qs.stringify({ 'x&injected=value': [] }, { allowEmptyArrays: true, ...options }), 'x&injected=value[]');
    }
  `], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
