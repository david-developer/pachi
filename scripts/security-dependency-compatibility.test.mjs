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

function expoCli() {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const expo = createRequire(mobile.resolve('expo/package.json'));
  return createRequire(expo.resolve('@expo/cli/package.json'));
}

function devToolsPluginFixture() {
  return {
    packageName: 'synthetic-plugin',
    packageRoot: '/synthetic/plugin',
    cliExtensions: {
      description: 'Synthetic compatibility fixture',
      entryPoint: 'synthetic.js',
      commands: [{
        name: 'inspect',
        title: 'Inspect synthetic item',
        environments: ['cli', 'mcp'],
        parameters: [{ name: 'item', type: 'text', description: 'Synthetic item' }],
      }],
    },
  };
}

test('API database and the exact Expo CLI resolve patched Zod without a legacy installed copy', () => {
  const cli = expoCli();
  assert.equal(cli('./package.json').version, '55.0.11');
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  // Those optional consumers use a Zod 3 JSON-schema converter. They are absent
  // from this toolchain; enabling Expo MCP requires revisiting this override.
  for (const consumer of [mobile, cli]) {
    for (const name of ['expo-mcp', '@expo/mcp-tunnel']) {
      assert.throws(() => consumer.resolve(name), { code: 'MODULE_NOT_FOUND' },
        `Adding ${name} requires revisiting the Expo CLI Zod override`);
    }
  }
  const consumers = [
    createRequire(new URL('../apps/api/package.json', import.meta.url)),
    createRequire(new URL('../packages/database/package.json', import.meta.url)),
    cli,
  ];
  for (const consumer of consumers) {
    assert.equal(consumer('zod/package.json').version, '4.6.6');
    assert.equal(typeof consumer('zod').z.compile, 'function');
  }
  const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.ok(documents.every((document) => document.errors.length === 0));
  const zodKeys = documents.flatMap((document) => Object.keys(document.toJSON().packages ?? {}))
    .filter((key) => key.startsWith('zod@'));
  assert.deepEqual(zodKeys, ['zod@4.6.6']);
});

test('actual Expo plugin schemas retain validation stripping and readonly arrays on Zod 4', () => {
  const { PluginSchema } = expoCli()('./build/src/start/server/DevToolsPlugin.schema.js');
  const fixture = devToolsPluginFixture();
  const parsed = PluginSchema.parse({ ...fixture, unknownFixtureField: true });
  assert.deepEqual(parsed, fixture);
  assert.equal(Object.isFrozen(parsed.cliExtensions.commands[0].environments), true);
  assert.throws(() => parsed.cliExtensions.commands[0].environments.push('other'), TypeError);
  for (const invalid of [
    { ...fixture, packageName: '' },
    { ...fixture, cliExtensions: { ...fixture.cliExtensions, commands: [] } },
    { ...fixture, cliExtensions: { ...fixture.cliExtensions, commands: [{
      ...fixture.cliExtensions.commands[0], environments: ['other'],
    }] } },
  ]) {
    const result = PluginSchema.safeParse(invalid);
    assert.equal(result.success, false);
    // Expo reads .message and .issues, both preserved across the Zod major.
    assert.equal(typeof result.error.message, 'string');
    assert.ok(result.error.issues.length > 0);
    assert.ok(result.error.issues.every((issue) => typeof issue.message === 'string' && Array.isArray(issue.path)));
  }
});

test('actual Expo MCP command schema retains strict keys enum validation and parameter descriptions', () => {
  const { createMCPDevToolsExtensionSchema } = expoCli()('./build/src/start/server/createMCPDevToolsExtensionSchema.js');
  const fixture = devToolsPluginFixture();
  const schema = createMCPDevToolsExtensionSchema(fixture);
  assert.deepEqual(schema.parse({ command: 'inspect', item: 'synthetic' }), { command: 'inspect', item: 'synthetic' });
  assert.deepEqual(schema.parse({ command: 'inspect' }), { command: 'inspect' });
  for (const invalid of [
    {}, { command: 'unknown' }, { command: 'inspect', item: 1 }, { command: 'inspect', extra: 'denied' },
  ]) assert.equal(schema.safeParse(invalid).success, false);
  assert.match(schema.shape.command.description, /inspect/);
  assert.match(schema.shape.item.description, /Synthetic item/);
  assert.throws(() => createMCPDevToolsExtensionSchema({ ...fixture, cliExtensions: undefined }), /no commands defined/);
  assert.throws(() => createMCPDevToolsExtensionSchema({
    ...fixture, cliExtensions: { ...fixture.cliExtensions, commands: [] },
  }), /no commands defined/);
});

test('actual Expo plugin output parsing keeps URL union and issue handling compatible', () => {
  const cli = expoCli();
  const { DevToolsPluginOutputSchema } = cli('./build/src/start/server/DevToolsPlugin.schema.js');
  const { DevToolsPluginCliExtensionResults } = cli('./build/src/start/server/DevToolsPluginCliExtensionResults.js');
  const output = [
    { type: 'text', text: 'Synthetic output', level: 'info' },
    { type: 'image', url: 'https://example.test/synthetic.webp' },
    { type: 'audio', url: 'https://example.test/synthetic.mp3', text: 'Synthetic audio' },
  ];
  assert.deepEqual(DevToolsPluginOutputSchema.parse(output), output);
  const results = new DevToolsPluginCliExtensionResults();
  assert.deepEqual(results.parseOutputText(JSON.stringify(output)), output);
  assert.deepEqual(results.parseOutputText('synthetic line\nsecond line', 'warning'), [
    { type: 'text', text: 'synthetic line', level: 'warning' },
    { type: 'text', text: 'second line', level: 'warning' },
  ]);
  for (const invalid of [
    [{ type: 'image', url: 'invalid URL' }],
    [{ type: 'audio', url: 1 }],
    [{ type: 'text', text: 1, level: 'info' }],
    [{ type: 'text', text: 'synthetic', level: 'unknown' }],
  ]) {
    assert.equal(DevToolsPluginOutputSchema.safeParse(invalid).success, false);
    const parsed = results.parseOutputText(JSON.stringify(invalid));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, 'text');
    assert.equal(parsed[0].level, 'error');
    assert.match(parsed[0].text, /^Invalid JSON: .+/);
  }
});

test('patched Zod bounds array set and map issues before visiting oversized input', () => {
  const zodPath = expoCli().resolve('zod');
  // Small fixed inputs reproduce the advisory's issue-accumulation behavior;
  // a child process bounds memory and execution if a resolution regresses.
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
    const assert = require('node:assert/strict');
    const { z } = require(${JSON.stringify(zodPath)});
    for (const mode of ['runtime', 'compiled']) {
      let visits = 0;
      const element = z.string().refine(() => { visits++; return true; });
      const schemas = [
        [z.array(element).max(2), Array(1000).fill('synthetic')],
        [z.array(element).length(2), Array(1000).fill(1)],
        [z.set(element).max(2), new Set(Array.from({ length: 1000 }, (_, i) => String(i)))],
        [z.map(element, element).max(2), new Map(Array.from({ length: 1000 }, (_, i) => [i, i]))],
      ];
      for (const [source, input] of schemas) {
        const schema = mode === 'compiled' ? z.compile(source, { strict: true }) : source;
        const parsed = schema.safeParse(input);
        assert.equal(parsed.success, false);
        assert.equal(parsed.error.issues.length, 1, mode);
        assert.equal(parsed.error.issues[0].code, 'too_big');
      }
      assert.equal(visits, 0, mode);
      const withinBound = z.array(element).max(2).safeParse(['one', 'two']);
      assert.equal(withinBound.success, true);
      assert.equal(visits, 2);
    }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

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
