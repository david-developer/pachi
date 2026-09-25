import { createDatabase, WebAuthSessionStore } from '@pachi/database';
import { webSession } from './session';

const database = createDatabase(process.env.DATABASE_URL ?? 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local');
const store = new WebAuthSessionStore(database.client, process.env.WEB_SESSION_SECRET ?? 'local-development-session-secret-change-me-please-32');

export async function webAuthSession() {
  const cookie = await webSession();
  if (!cookie.id) return { cookie, auth: null };
  return { cookie, auth: await store.read(cookie.id) };
}

export { store as webAuthSessionStore };
