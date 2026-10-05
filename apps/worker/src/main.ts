import { runAnalyticsWorker } from './analytics-worker.js';
import { AnalyticsStore, createDatabase, ListingMediaStore, OrganizationStore, ProviderVerificationStore } from '@pachi/database';
import { createMediaWorkerFromEnvironment, runMediaWorker } from './media-worker.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required by the media worker');
if (process.env.NODE_ENV === 'production') throw new Error('The local filesystem media worker cannot run in production');
const { client } = createDatabase(databaseUrl);
const mediaStore = new ListingMediaStore(client);
const mediaRoot = process.env.MEDIA_STORAGE_ROOT ?? '../../.local-media';
const worker = createMediaWorkerFromEnvironment(mediaStore, mediaRoot);
const abort = new AbortController();
const analyticsTask = process.env.ANALYTICS_PSEUDONYM_SECRET
  ? runAnalyticsWorker({ store: new AnalyticsStore(client, process.env.ANALYTICS_PSEUDONYM_SECRET), signal: abort.signal })
  : Promise.resolve();
if (!process.env.ANALYTICS_PSEUDONYM_SECRET) console.log(JSON.stringify({ event: 'analytics_worker_disabled', reason: 'PSEUDONYM_SECRET_NOT_CONFIGURED' }));
const workerTask = runMediaWorker({ ...worker, signal: abort.signal });
const verificationStore = new ProviderVerificationStore(client, process.env.VERIFICATION_EVIDENCE_SECRET ?? '');
const organizationStore = new OrganizationStore(client);
const retentionTimer = setInterval(() => {
  void verificationStore.expireClaims().then(() => verificationStore.purgeExpiredEvidence()).catch(() => console.error(JSON.stringify({event:'verification_maintenance_failed'})));
  void organizationStore.expireInvitations().catch(() => console.error(JSON.stringify({event:'organization_invitation_maintenance_failed'})));
}, 60_000);

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ event: 'worker_shutdown', signal }));
  abort.abort();
  clearInterval(retentionTimer);
  await Promise.all([workerTask, analyticsTask]);
  await client.end();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
console.log(JSON.stringify({ event: 'worker_started', mode: 'local-media', storage: 'private-filesystem', scanner: 'clamav' }));
await Promise.all([workerTask, analyticsTask]);
