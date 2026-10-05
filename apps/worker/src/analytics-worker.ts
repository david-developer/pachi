import { setTimeout } from 'node:timers/promises';
import { AnalyticsStore } from '@pachi/database';

export const processAnalyticsOnce = (store: AnalyticsStore) =>
  store.processAnalyticsOnce();
export async function runAnalyticsWorker(options: {
  store: AnalyticsStore;
  signal: AbortSignal;
  pollMilliseconds?: number;
}) {
  while (!options.signal.aborted) {
    try {
      await processAnalyticsOnce(options.store);
    } catch {
      console.error(JSON.stringify({ event: 'analytics_consumption_failed' }));
    }
    try {
      await setTimeout(options.pollMilliseconds ?? 1000, undefined, {
        signal: options.signal,
      });
    } catch {
      if (!options.signal.aborted) throw new Error('ANALYTICS_POLL_FAILED');
    }
  }
}
