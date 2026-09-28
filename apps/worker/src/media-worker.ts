import { ClamAvScanner, LocalPrivateMediaStorage, processOneMediaJob, type MalwareScanner } from '@pachi/media';
import { ListingMediaStore } from '@pachi/database';

export const processMediaOnce = processOneMediaJob;

export async function runMediaWorker(options: { store: ListingMediaStore; storage: LocalPrivateMediaStorage; scanner: MalwareScanner; intervalMs?: number; signal?: AbortSignal }): Promise<void> {
  const interval = options.intervalMs ?? 1000;
  while (!options.signal?.aborted) {
    let didWork = false;
    try {
      didWork = await processMediaOnce(options.store, options.storage, options.scanner);
    } catch { didWork = false; }
    if (didWork) continue;
    await new Promise<void>((resolve) => {
      const complete = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', complete); resolve(); };
      const timer = setTimeout(complete, interval);
      options.signal?.addEventListener('abort', complete, { once: true });
    });
  }
}

export function createMediaWorkerFromEnvironment(store: ListingMediaStore, root: string) {
  return { store, storage: new LocalPrivateMediaStorage(root), scanner: new ClamAvScanner(process.env.CLAMAV_HOST ?? '127.0.0.1', Number(process.env.CLAMAV_PORT ?? 3310)) };
}
