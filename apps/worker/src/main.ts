import { createDatabase, ListingMediaStore } from '@pachi/database';
import { createMediaWorkerFromEnvironment, runMediaWorker } from './media-worker.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required by the media worker');
if (process.env.NODE_ENV === 'production') throw new Error('The local filesystem media worker cannot run in production');
const { client } = createDatabase(databaseUrl);
const mediaStore = new ListingMediaStore(client);
const mediaRoot = process.env.MEDIA_STORAGE_ROOT ?? '../../.local-media';
const worker = createMediaWorkerFromEnvironment(mediaStore, mediaRoot);
const abort = new AbortController();
const workerTask = runMediaWorker({ ...worker, signal: abort.signal });

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ event: 'worker_shutdown', signal }));
  abort.abort();
  await workerTask;
  await client.end();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
console.log(JSON.stringify({ event: 'worker_started', mode: 'local-media', storage: 'private-filesystem', scanner: 'clamav' }));
await workerTask;
