import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { ClamAvScanner, LocalPrivateMediaStorage, MAX_IMAGE_PIXELS, MAX_ORIGINAL_BYTES, MediaProcessingError, processListingImage, sniffListingImage } from '../dist/index.js';

void test('re-encodes, strips metadata, bounds variants, and preserves the private source separately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pachi-media-unit-'));
  try {
    const source = await sharp({ create: { width: 960, height: 640, channels: 3, background: { r: 22, g: 90, b: 70 } } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Synthetic private fixture' }, GPS: { GPSLatitude: '1,2,3', GPSLongitude: '4,5,6' } } }).toBuffer();
    assert.ok((await sharp(source).metadata()).exif);
    assert.equal(sniffListingImage(source)?.mime, 'image/jpeg');
    const result = await processListingImage(source, { scan: async () => 'CLEAN' });
    assert.deepEqual([...result.variants.keys()], [320, 640, 1280, 1920]);
    for (const variant of result.variants.values()) {
      const metadata = await sharp(variant).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.icc, undefined);
      assert.equal(metadata.xmp, undefined);
      assert.equal(metadata.iptc, undefined);
      assert.ok(Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 960);
    }
    const storage = new LocalPrivateMediaStorage(root);
    const reference = '008b6ad6-0da5-4c34-a6c9-bb774ccba922';
    await storage.putQuarantine(reference, source);
    assert.deepEqual(await storage.readQuarantine(reference), source);
    await storage.writeVariant(reference, 320, result.variants.get(320));
    assert.deepEqual(await storage.readVariant(reference, 320), result.variants.get(320));
    await storage.removeAsset(reference);
    await assert.rejects(() => readFile(join(root, 'quarantine', `${reference}.original`)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test('unsupported and infected images are rejected without a ready derivative', async () => {
  assert.equal(sniffListingImage(Buffer.from('<svg/>')), null);
  await assert.rejects(() => processListingImage(Buffer.from('<svg/>'), { scan: async () => 'CLEAN' }), (error) => error instanceof MediaProcessingError && error.code === 'INVALID_IMAGE' && !error.retryable);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  await assert.rejects(() => processListingImage(png, { scan: async () => 'INFECTED' }), (error) => error instanceof MediaProcessingError && error.code === 'INFECTED_FILE' && !error.retryable);
  await assert.rejects(() => processListingImage(png, { scan: async () => { throw new Error('scanner offline'); } }), (error) => error instanceof MediaProcessingError && error.code === 'SCAN_UNAVAILABLE' && error.retryable);
});

void test('enforces the original byte and decoded pixel ceilings', async () => {
  const tooManyBytes = Buffer.alloc(MAX_ORIGINAL_BYTES + 1);
  await assert.rejects(() => processListingImage(tooManyBytes, { scan: async () => 'CLEAN' }), (error) => error instanceof MediaProcessingError && error.code === 'INVALID_IMAGE');
  const pixels = MAX_IMAGE_PIXELS + 1;
  const width = Math.floor(Math.sqrt(pixels));
  const height = Math.ceil(pixels / width);
  const oversized = await sharp({ create: { width, height, channels: 3, background: { r: 50, g: 90, b: 70 } } }).png().toBuffer();
  await assert.rejects(() => processListingImage(oversized, { scan: async () => 'CLEAN' }), (error) => error instanceof MediaProcessingError && error.code === 'IMAGE_TOO_LARGE' && !error.retryable);
});

void test('ClamAV adapter uses INSTREAM and propagates infected responses', async () => {
  const server = createServer((socket) => {
    let pending = Buffer.alloc(0);
    let offset = -1;
    let responseSent = false;
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (offset < 0) {
        const commandEnd = pending.indexOf(0);
        if (commandEnd < 0) return;
        assert.equal(pending.subarray(0, commandEnd).toString(), 'zINSTREAM');
        offset = commandEnd + 1;
      }
      while (!responseSent && pending.length >= offset + 4) {
        const length = pending.readUInt32BE(offset);
        offset += 4;
        if (length === 0) {
          responseSent = true;
          socket.end('stream: Eicar-Test-Signature FOUND\0');
          return;
        }
        if (pending.length < offset + length) { offset -= 4; return; }
        offset += length;
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    const scanner = new ClamAvScanner('127.0.0.1', address.port, 1000);
    assert.equal(await scanner.scan(Buffer.from('synthetic bytes')), 'INFECTED');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
