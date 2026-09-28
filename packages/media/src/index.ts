import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp, { type Metadata } from 'sharp';

export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const LISTING_IMAGE_VARIANTS = [320, 640, 1280, 1920] as const;
export const MEDIA_PROCESSOR_VERSION = 'listing-webp-v1';

export type ListingImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type VariantInfo = { width: number; height: number; bytes: number; mime: 'image/webp' };
export type ProcessedListingImage = { width: number; height: number; originalSha256: string; variants: Record<string, VariantInfo> };

export class MediaProcessingError extends Error {
  public constructor(public readonly code: 'SCAN_UNAVAILABLE' | 'PROCESSING_UNAVAILABLE' | 'SOURCE_MISSING' | 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE' | 'INFECTED_FILE' | 'CHECKSUM_MISMATCH', message: string, public readonly retryable: boolean) { super(message); }
}

export interface MalwareScanner { scan(bytes: Buffer): Promise<'CLEAN' | 'INFECTED'>; }
export type MediaProcessingJob = { id: string; jobId: string; storageReference: string; originalMime: string; originalBytes: number; originalSha256: string; ownerProviderAccountId: string; attemptCount: number };
export type MediaCleanupJob = { id: string; storageReference: string };
export interface MediaQueueStore {
  claimCleanup(): Promise<MediaCleanupJob | null>;
  claimProcessing(): Promise<MediaProcessingJob | null>;
  markDeleted(id: string): Promise<void>;
  markReady(job: MediaProcessingJob, output: ProcessedListingImage, processorVersion: string): Promise<boolean>;
  markFailure(job: MediaProcessingJob, code: string, retryable: boolean): Promise<void>;
}

export class LocalPrivateMediaStorage {
  private readonly root: string;
  public constructor(root: string) { this.root = resolve(root); }

  public async putQuarantine(reference: string, bytes: Buffer): Promise<void> {
    this.assertReference(reference);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    const directory = join(this.root, 'quarantine');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(join(directory, `${reference}.original`), bytes, { flag: 'wx', mode: 0o600 });
  }

  public async readQuarantine(reference: string): Promise<Buffer> {
    this.assertReference(reference);
    try { return await readFile(join(this.root, 'quarantine', `${reference}.original`)); }
    catch { throw new MediaProcessingError('SOURCE_MISSING', 'Quarantined upload is not available', false); }
  }

  public async writeVariant(reference: string, width: number, bytes: Buffer): Promise<void> {
    this.assertReference(reference); this.assertVariant(width);
    const directory = join(this.root, 'derivatives', reference, MEDIA_PROCESSOR_VERSION);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(join(directory, `${width}.webp`), bytes, { mode: 0o600 });
  }

  public async readVariant(reference: string, width: number): Promise<Buffer> {
    this.assertReference(reference); this.assertVariant(width);
    return readFile(join(this.root, 'derivatives', reference, MEDIA_PROCESSOR_VERSION, `${width}.webp`));
  }

  public async removeAsset(reference: string): Promise<void> {
    this.assertReference(reference);
    await Promise.all([
      rm(join(this.root, 'quarantine', `${reference}.original`), { force: true }),
      rm(join(this.root, 'derivatives', reference), { recursive: true, force: true }),
    ]);
  }

  private assertReference(reference: string): void { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) throw new Error('Invalid media storage reference'); }
  private assertVariant(width: number): void { if (!(LISTING_IMAGE_VARIANTS as readonly number[]).includes(width)) throw new Error('Unsupported media variant'); }
}

export class ClamAvScanner implements MalwareScanner {
  public constructor(private readonly host = '127.0.0.1', private readonly port = 3310, private readonly timeoutMs = 30_000) {}

  public scan(bytes: Buffer): Promise<'CLEAN' | 'INFECTED'> {
    return new Promise((resolveScan, rejectScan) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const response: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, result?: 'CLEAN' | 'INFECTED') => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) rejectScan(new MediaProcessingError('SCAN_UNAVAILABLE', 'Malware scanning is temporarily unavailable', true));
        else if (result) resolveScan(result);
      };
      socket.setTimeout(this.timeoutMs, () => finish(new Error('scanner timeout')));
      socket.on('error', (error) => finish(error));
      socket.on('data', (chunk: Buffer) => {
        response.push(chunk);
        const text = Buffer.concat(response).toString('utf8');
        if (!text.includes('\0')) return;
        if (text.endsWith(' OK\0')) finish(undefined, 'CLEAN');
        else if (text.endsWith(' FOUND\0')) finish(undefined, 'INFECTED');
        else finish(new Error('scanner response unavailable'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
          const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
          socket.write(length); socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

export async function processListingImage(bytes: Buffer, scanner: MalwareScanner): Promise<{ output: ProcessedListingImage; variants: Map<number, Buffer> }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ORIGINAL_BYTES) throw new MediaProcessingError('INVALID_IMAGE', 'Image file is invalid', false);
  const signature = sniffListingImage(bytes);
  if (!signature) throw new MediaProcessingError('INVALID_IMAGE', 'Image content is not a supported format', false);
  let scanResult: 'CLEAN' | 'INFECTED';
  try { scanResult = await scanner.scan(bytes); }
  catch (error) { if (error instanceof MediaProcessingError) throw error; throw new MediaProcessingError('SCAN_UNAVAILABLE', 'Malware scanning is temporarily unavailable', true); }
  if (scanResult === 'INFECTED') throw new MediaProcessingError('INFECTED_FILE', 'Image failed the safety scan', false);

  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata(); }
  catch (error) { if (error instanceof Error && /pixel limit/i.test(error.message)) throw new MediaProcessingError('IMAGE_TOO_LARGE', 'Image dimensions exceed the supported limit', false); throw new MediaProcessingError('INVALID_IMAGE', 'Image could not be decoded', false); }
  if (metadata.format !== signature.format || !metadata.width || !metadata.height) throw new MediaProcessingError('INVALID_IMAGE', 'Image content is not a supported format', false);
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new MediaProcessingError('IMAGE_TOO_LARGE', 'Image dimensions exceed the supported limit', false);
  try { await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).stats(); }
  catch (error) { if (error instanceof Error && /pixel limit/i.test(error.message)) throw new MediaProcessingError('IMAGE_TOO_LARGE', 'Image dimensions exceed the supported limit', false); throw new MediaProcessingError('INVALID_IMAGE', 'Image could not be decoded', false); }

  const variants = new Map<number, Buffer>();
  const variantInfo: Record<string, VariantInfo> = {};
  for (const bound of LISTING_IMAGE_VARIANTS) {
    try {
      const bytesOut = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).rotate().resize({ width: bound, height: bound, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
      variants.set(bound, bytesOut.data);
      variantInfo[String(bound)] = { width: bytesOut.info.width, height: bytesOut.info.height, bytes: bytesOut.data.byteLength, mime: 'image/webp' };
    } catch { throw new MediaProcessingError('PROCESSING_UNAVAILABLE', 'Image variants could not be generated', true); }
  }
  return { output: { width: metadata.width, height: metadata.height, originalSha256: createHash('sha256').update(bytes).digest('hex'), variants: variantInfo }, variants };
}

export async function processOneMediaJob(store: MediaQueueStore, storage: LocalPrivateMediaStorage, scanner: MalwareScanner, onUnexpectedError?: (error: unknown) => void): Promise<boolean> {
  const cleanup = await store.claimCleanup();
  if (cleanup) {
    try { await storage.removeAsset(cleanup.storageReference); await store.markDeleted(cleanup.id); }
    catch { return false; }
    return true;
  }
  const job = await store.claimProcessing();
  if (!job) return false;
  try {
    const original = await storage.readQuarantine(job.storageReference);
    const detected = sniffListingImage(original);
    if (!detected || detected.mime !== job.originalMime || original.byteLength !== Number(job.originalBytes)) throw new MediaProcessingError('INVALID_IMAGE', 'Stored upload did not match its verified type and size', false);
    if (createHash('sha256').update(original).digest('hex') !== job.originalSha256) throw new MediaProcessingError('CHECKSUM_MISMATCH', 'Stored upload did not match its authorized checksum', false);
    const processed = await processListingImage(original, scanner);
    for (const [width, bytes] of processed.variants) await storage.writeVariant(job.storageReference, width, bytes);
    const persisted = await store.markReady(job, processed.output, MEDIA_PROCESSOR_VERSION);
    if (!persisted) { await storage.removeAsset(job.storageReference); await store.markDeleted(job.id); }
  } catch (error) {
    onUnexpectedError?.(error);
    if (error instanceof MediaProcessingError) await store.markFailure(job, error.code, error.retryable);
    else await store.markFailure(job, 'PROCESSING_UNAVAILABLE', true);
  }
  return true;
}

export function sniffListingImage(bytes: Buffer): { mime: ListingImageMime; format: 'jpeg' | 'png' | 'webp' } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', format: 'jpeg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', format: 'png' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', format: 'webp' };
  return null;
}
