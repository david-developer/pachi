import { sameStaffOrigin, staffCsrfValid } from './csrf';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { createDatabase, StaffStore } from '@pachi/database';
import * as oidc from 'openid-client';
import { staffConfig } from './config';
import { configuration, verifyAccess } from './provider';
export type StaffCookie = {
  id?: string;
  csrf?: string;
  transaction?: string;
  state?: string;
  nonce?: string;
  verifier?: string;
};
let store: StaffStore | undefined;
export function staffStore() {
  const c = staffConfig();
  return (store ??= new StaffStore(createDatabase().client, c.secret));
}
export async function staffCookie() {
  const c = staffConfig();
  return getIronSession<StaffCookie>(await cookies(), {
    cookieName: 'pachi_staff_session',
    password: c.secret,
    ttl: 8 * 3600,
    cookieOptions: {
      httpOnly: true,
      secure: new URL(c.origin).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 3600,
    },
  });
}
export function validOrigin(request: Request) {
  return sameStaffOrigin(request, staffConfig().origin);
}
export function validCsrf(request: Request, expected: string | undefined) {
  return staffCsrfValid(request, staffConfig().origin, expected);
}
export async function staffAccess(id: string) {
  return staffStore().tokens(id, async (_access, refresh) => {
    const tokens = await oidc.refreshTokenGrant(await configuration(), refresh);
    if (!tokens.refresh_token) throw new Error('ROTATION_REQUIRED');
    const claims = await verifyAccess(tokens.access_token);
    return {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expiresAt: claims.expiresAt,
      claims,
    };
  });
}
export async function revoke(id: string) {
  const refresh = await staffStore().revoke(id);
  if (refresh) {
    try {
      await oidc.tokenRevocation(await configuration(), refresh);
    } catch {
      console.error(JSON.stringify({ event: 'staff_auth', stage: 'provider_revoke_failed' }));
    }
  }
}
