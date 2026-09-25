import { createDatabase, WebAuthSessionStore } from '@pachi/database';
import * as oidc from 'openid-client';
import { oidcConfigured, oidcConfiguration } from './oidc';
import { webSession } from './session';

let store: WebAuthSessionStore | undefined;

function sessionStore(): WebAuthSessionStore {
  if (!store) {
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured in production');
    const database = createDatabase(process.env.DATABASE_URL ?? 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local');
    store = new WebAuthSessionStore(database.client, process.env.WEB_SESSION_SECRET ?? 'local-development-session-secret-change-me-please-32');
  }
  return store;
}

export async function webAuthSession() {
  const cookie = await webSession();
  if (!cookie.id) return { cookie, auth: null };
  const auth = await sessionStore().read(cookie.id);
  if (!auth) { cookie.destroy(); return { cookie, auth: null }; }
  if (auth.expiresAt <= new Date() && auth.refreshToken && oidcConfigured()) {
    try {
      const tokens = await oidc.refreshTokenGrant(await oidcConfiguration(), auth.refreshToken);
      if (!tokens.access_token) throw new Error('missing_access_token');
      await sessionStore().updateTokens(auth.id, tokens.access_token, tokens.refresh_token, new Date(Date.now() + (tokens.expires_in ?? 300) * 1000));
      return { cookie, auth: await sessionStore().read(auth.id) };
    } catch { await sessionStore().revoke(auth.id); cookie.destroy(); return { cookie, auth: null }; }
  }
  if (auth.expiresAt <= new Date()) { await sessionStore().revoke(auth.id); cookie.destroy(); return { cookie, auth: null }; }
  return { cookie, auth };
}

export const webAuthSessionStore = { create: (...args: Parameters<WebAuthSessionStore['create']>) => sessionStore().create(...args), updateTokens: (...args: Parameters<WebAuthSessionStore['updateTokens']>) => sessionStore().updateTokens(...args), revoke: (...args: Parameters<WebAuthSessionStore['revoke']>) => sessionStore().revoke(...args) };
