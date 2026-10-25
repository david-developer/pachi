import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const scenario = process.argv[2] === '--http-compatibility-fixture' ? process.argv[3] : undefined;

// Each fixture uses the API's actual installed Nest/Express/Multer graph. A
// vulnerable parser can crash its bounded child without taking down the runner.
if (scenario) {
  await runFixture(scenario);
} else {
  for (const [name, fixture] of [
    ['Nest default JSON/form parsers reject bounded malformed and oversized requests without a compression crash', 'body'],
    ['Nest multipart interceptor preserves limits and removes rejected or cancelled disk uploads', 'multipart'],
    ['Nest multipart teardown survives a pending async file filter resuming after rejection', 'async-filter'],
  ]) {
    test(name, () => {
      const child = spawnSync(process.execPath, [
        '--max-old-space-size=128', fileURLToPath(import.meta.url), '--http-compatibility-fixture', fixture,
      ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
      assert.ifError(child.error);
      assert.equal(child.signal, null, child.stderr);
      assert.equal(child.status, 0, child.stderr || child.stdout);
    });
  }
}

function multipart(parts, close = true) {
  return Buffer.from(parts.map(({ name, filename, value }) =>
    `--SyntheticBoundary\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n${filename ? 'Content-Type: text/plain\r\n' : ''}\r\n${value}\r\n`,
  ).join('') + (close ? '--SyntheticBoundary--\r\n' : ''));
}

function request(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = http.request({
      host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', agent: false,
      headers: body ? { 'content-length': body.length, ...headers } : headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    client.setTimeout(2000, () => client.destroy(new Error('Synthetic request timed out')));
    client.on('error', reject);
    client.end(body);
  });
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail('Synthetic upload did not finish cleanup');
}

async function runFixture(fixture) {
  const api = createRequire(new URL('../apps/api/package.json', import.meta.url));
  api('reflect-metadata');
  const { NestFactory } = api('@nestjs/core');
  const { BadRequestException, Controller, Get, Module, Post, Req, UseInterceptors } = api('@nestjs/common');
  const { AnyFilesInterceptor, FileInterceptor } = api('@nestjs/platform-express');
  const platform = createRequire(api.resolve('@nestjs/platform-express/package.json'));
  const { diskStorage } = platform('multer');
  const directory = await mkdtemp(join(tmpdir(), 'pachi-http-compat-'));
  const state = { handled: 0, removed: 0, streams: [], pending: undefined, parser: undefined, request: undefined };
  const disk = diskStorage({ destination: directory });
  const storage = {
    _handleFile(req, file, callback) {
      state.streams.push(file.stream);
      disk._handleFile(req, file, (error, info) => { state.handled++; callback(error, info); });
    },
    _removeFile(req, file, callback) {
      disk._removeFile(req, file, (error) => { state.removed++; callback(error); });
    },
  };
  class SyntheticController {
    live() { return { live: true }; }
    echo(req) { return req.body; }
    upload(req) { return { fields: req.body, size: req.file?.size }; }
    asyncUpload() { assert.fail('Rejected synthetic upload reached the controller'); }
  }
  Controller()(SyntheticController);
  for (const [method, decorator] of [['live', Get('live')], ['echo', Post('echo')], ['upload', Post('upload')], ['asyncUpload', Post('async-upload')]]) {
    decorator(SyntheticController.prototype, method, Object.getOwnPropertyDescriptor(SyntheticController.prototype, method));
    Req()(SyntheticController.prototype, method, 0);
  }
  UseInterceptors(FileInterceptor('file', {
    storage, limits: { fileSize: 8, files: 1, fields: 1, parts: 2, fieldSize: 8 },
  }))(SyntheticController.prototype, 'upload', Object.getOwnPropertyDescriptor(SyntheticController.prototype, 'upload'));
  UseInterceptors(AnyFilesInterceptor({
    storage, fileHwm: 1,
    streamHandler(req, parser) { state.parser = parser; req.pipe(parser); },
    fileFilter(req, file, callback) {
      state.request = req;
      if (file.fieldname === 'first') state.pending = callback;
      else req.once('end', () => setImmediate(() => callback(new BadRequestException('Synthetic rejected file'))));
    },
  }))(SyntheticController.prototype, 'asyncUpload', Object.getOwnPropertyDescriptor(SyntheticController.prototype, 'asyncUpload'));
  class SyntheticModule {}
  Module({ controllers: [SyntheticController] })(SyntheticModule);
  // Production main.ts also uses NestFactory's default body-parser middleware.
  const app = await NestFactory.create(SyntheticModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const live = async () => assert.deepEqual(await request(port, '/live'), { status: 200, body: '{"live":true}' });
    const post = (body, type = 'application/json', extra = {}) => request(port, '/echo', Buffer.from(body), { 'content-type': type, ...extra });
    const upload = (parts, close = true) => request(port, '/upload', multipart(parts, close), { 'content-type': 'multipart/form-data; boundary=SyntheticBoundary' });

    if (fixture === 'body') {
      assert.deepEqual(await post('{"city":"Douala"}'), { status: 201, body: '{"city":"Douala"}' });
      assert.deepEqual(await post('city=Douala+Centre&label=%C3%A9&nested[value]=safe', 'application/x-www-form-urlencoded'),
        { status: 201, body: '{"city":"Douala Centre","label":"é","nested":{"value":"safe"}}' });
      assert.equal((await post('{"incomplete":')).status, 400);
      assert.equal((await post(JSON.stringify({ value: 'x'.repeat(100 * 1024) }))).status, 413);
      assert.equal((await post(`value=${'x'.repeat(100 * 1024)}`, 'application/x-www-form-urlencoded')).status, 413);
      assert.equal((await post('city=synthetic', 'application/x-www-form-urlencoded; charset=utf-999')).status, 415);
      assert.equal((await post(`deep${'[child]'.repeat(34)}=safe`, 'application/x-www-form-urlencoded')).status, 400);
      assert.equal((await post(Buffer.from('not gzip'), 'application/json', { 'content-encoding': 'gzip' })).status, 400);
      assert.deepEqual(await post(gzipSync('{"city":"Douala"}'), 'application/json', { 'content-encoding': 'gzip' }),
        { status: 201, body: '{"city":"Douala"}' });
      assert.equal((await post(gzipSync(JSON.stringify({ value: 'x'.repeat(100 * 1024) })), 'application/json', { 'content-encoding': 'gzip' })).status, 413);
      // One valid gzip frame followed by bounded trailing bytes previously
      // emitted an unhandled decoder error after the parser had responded.
      const trailing = Buffer.concat([gzipSync('{"city":"Douala"}'), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
      assert.deepEqual(await post(trailing, 'application/json', { 'content-encoding': 'gzip' }),
        { status: 201, body: '{"city":"Douala"}' });
      await delay(200);
      await live();
    } else if (fixture === 'multipart') {
      const file = { name: 'file', filename: 'synthetic.txt', value: '12345678' };
      const accepted = await upload([{ name: 'note', value: '12345678' }, file]);
      assert.equal(accepted.status, 201, accepted.body);
      assert.deepEqual(JSON.parse(accepted.body), { fields: { note: '12345678' }, size: 8 });
      assert.equal((await readdir(directory)).length, 1);
      for (const name of await readdir(directory)) await rm(join(directory, name));
      assert.equal((await upload([{ name: 'note', value: '123456789' }])).status, 400);
      assert.equal((await upload([{ ...file, value: '123456789' }])).status, 413);
      assert.equal((await upload([file, file])).status, 400);
      assert.equal((await upload([{ ...file, name: 'unexpected' }])).status, 400);
      assert.equal((await upload([{ name: 'first', value: 'one' }, { name: 'second', value: 'two' }])).status, 400);
      assert.equal((await upload([{ ...file, value: 'x' }], false)).status, 400);
      await waitFor(async () => (await readdir(directory)).length === 0);
      assert.ok(state.removed > 0, 'Rejected uploads must run the actual disk storage cleanup');
      const beforeStreams = state.streams.length;
      const beforeRemoved = state.removed;
      const client = http.request({
        host: '127.0.0.1', port, path: '/upload', method: 'POST', agent: false,
        headers: { 'content-type': 'multipart/form-data; boundary=SyntheticBoundary', 'content-length': 1024 },
      });
      client.on('error', () => {}); // The client intentionally cancels; server errors remain unmasked.
      client.write('--SyntheticBoundary\r\nContent-Disposition: form-data; name="file"; filename="cancelled.txt"\r\nContent-Type: text/plain\r\n\r\n1234');
      try {
        await waitFor(async () => state.streams.length > beforeStreams && (await readdir(directory)).length === 1);
        const stream = state.streams.at(-1);
        const closed = new Promise((resolve) => stream.once('close', resolve));
        client.destroy();
        await closed;
        await waitFor(async () => state.removed > beforeRemoved && (await readdir(directory)).length === 0);
        assert.equal(stream.destroyed, true);
        await live();
      } finally {
        client.destroy();
      }
    } else if (fixture === 'async-filter') {
      // The first file is parked while a second filter rejects a truncated
      // form. Resume only after Multer's listener-removal turn has completed.
      const result = await request(port, '/async-upload', multipart([
        { name: 'first', filename: 'first.txt', value: 'a' },
        { name: 'second', filename: 'second.txt', value: 'b' },
      ], false), { 'content-type': 'multipart/form-data; boundary=SyntheticBoundary' });
      assert.equal(result.status, 400, result.body);
      assert.equal(typeof state.pending, 'function');
      await immediate();
      // Do not attach an error listener here: it would mask the old crash.
      const closed = new Promise((resolve) => state.parser.once('close', resolve));
      state.pending(null, true);
      await closed;
      assert.deepEqual(state.request.files, []);
      assert.equal(state.handled, 0, 'A rejected pending filter must not reach storage');
      assert.deepEqual(await readdir(directory), []);
      await live();
    } else assert.fail(`Unknown synthetic fixture: ${fixture}`);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}
