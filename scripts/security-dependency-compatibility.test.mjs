import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';

function atLeast(version, minimum) {
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

test('patched Sharp and shell-quote resolutions preserve the source-map and audit policy boundary', () => {
  const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.ok(documents.every((document) => document.errors.length === 0));
  const keys = documents.flatMap((document) => Object.keys(document.toJSON().packages ?? {}));
  const sharpKeys = keys.filter((key) => key.startsWith('sharp@'));
  assert.equal(sharpKeys.length, 1);
  const sharpVersion = sharpKeys[0].slice('sharp@'.length);
  assert.ok(atLeast(sharpVersion, '0.35.5'));
  const platforms = keys.filter((key) => key.startsWith('@img/sharp-') && !key.startsWith('@img/sharp-libvips-'));
  assert.ok(platforms.length > 0);
  assert.ok(platforms.every((key) => key.endsWith(`@${sharpVersion}`)));
  const shellKeys = keys.filter((key) => key.startsWith('shell-quote@'));
  assert.deepEqual(shellKeys, ['shell-quote@1.11.0']);
  assert.ok(shellKeys.every((key) => atLeast(key.slice('shell-quote@'.length), '1.11.0')));
  assert.deepEqual(keys.filter((key) => key.startsWith('source-map-js@')), ['source-map-js@1.2.2']);

  const media = createRequire(new URL('../packages/media/package.json', import.meta.url));
  assert.equal(media('sharp').versions.sharp, sharpVersion);
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const native = createRequire(mobile.resolve('react-native/package.json'));
  const devtools = createRequire(native.resolve('react-devtools-core/package.json'));
  assert.equal(devtools('shell-quote/package.json').version, '1.11.0');
  const policy = spawnSync(process.execPath, [new URL('./check-dependency-audit-policy.mjs', import.meta.url).pathname], { encoding: 'utf8', timeout: 5000 });
  assert.equal(policy.error, undefined);
  assert.equal(policy.status, 0, policy.stderr);
});

test('shell-quote rejects comment-following line terminators and preserves React DevTools parsing', () => {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const native = createRequire(mobile.resolve('react-native/package.json'));
  const devtools = createRequire(native.resolve('react-devtools-core/package.json'));
  const shellQuotePath = devtools.resolve('shell-quote');
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const assert = require('node:assert/strict');
    const { parse, quote } = require(${JSON.stringify(shellQuotePath)});
    assert.deepEqual(parse('synthetic --flag "safe value"'), ['synthetic', '--flag', 'safe value']);
    assert.deepEqual(parse(quote(['synthetic', 'safe value'])), ['synthetic', 'safe value']);
    for (const terminator of ['\\n', '\\r', '\\u2028', '\\u2029']) {
      assert.throws(() => quote(['synthetic', { comment: 'fixture' }, 'before' + terminator + 'after']), TypeError);
    }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('patched Sharp preserves JPEG PNG WebP processing and checksum denial without loosening intake', () => {
  const media = createRequire(new URL('../packages/media/package.json', import.meta.url));
  const sharpPath = media.resolve('sharp');
  const pipelineUrl = new URL('../packages/media/dist/index.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--max-old-space-size=128', '-e', `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const sharp = require(${JSON.stringify(sharpPath)});
    const { processListingImage, processOneMediaJob, sniffListingImage } = await import(${JSON.stringify(pipelineUrl)});
    let jpeg;
    for (const format of ['jpeg', 'png', 'webp']) {
      const source = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#225a46' } })
        [format]().withMetadata({ exif: { IFD0: { Artist: 'Synthetic private fixture' } } }).toBuffer();
      assert.equal(sniffListingImage(source)?.format, format);
      const { output, variants } = await processListingImage(source, { scan: async () => 'CLEAN' });
      assert.equal(output.originalSha256, createHash('sha256').update(source).digest('hex'));
      assert.deepEqual([...variants.keys()], [320, 640, 1280, 1920]);
      for (const [bound, bytes] of variants) {
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.exif, undefined);
        assert.equal(metadata.icc, undefined);
        assert.equal(metadata.xmp, undefined);
        assert.equal(metadata.iptc, undefined);
        assert.ok(metadata.width <= 96 && metadata.height <= 64 && Math.max(metadata.width, metadata.height) <= bound);
        assert.equal(output.variants[bound].bytes, bytes.length);
      }
      if (format === 'jpeg') jpeg = source;
    }
    assert.equal(sniffListingImage(Buffer.from('<svg/>')), null);
    await assert.rejects(() => processListingImage(Buffer.from('<svg/>'), { scan: async () => { throw new Error('must not scan SVG'); } }), { code: 'INVALID_IMAGE' });
    const failures = [];
    const job = { id: 'synthetic', originalMime: 'image/jpeg', originalBytes: jpeg.length, originalSha256: '0'.repeat(64) };
    await processOneMediaJob({ claimCleanup: async () => null, claimProcessing: async () => job,
      markFailure: async (_job, code, retryable) => failures.push({ code, retryable }),
      markReady: async () => { throw new Error('checksum mismatch must never become READY'); } },
      { readQuarantine: async () => jpeg, writeVariant: async () => { throw new Error('must not write variants'); } },
      { scan: async () => { throw new Error('checksum mismatch must precede scan'); } });
    assert.deepEqual(failures, [{ code: 'CHECKSUM_MISMATCH', retryable: false }]);
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

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
