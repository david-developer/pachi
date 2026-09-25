import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';

export type WebSession = {
  id?: string;
  userId?: string;
  accountState?: 'PENDING_PHONE' | 'ACTIVE' | 'LIMITED' | 'SUSPENDED' | 'DEACTIVATED' | 'DELETION_PENDING' | 'DELETED';
  participationAllowed?: boolean;
  csrfToken?: string;
  oidcState?: string;
  oidcNonce?: string;
  pkceVerifier?: string;
  returnTo?: string;
};

export const sessionOptions = {
  cookieName: 'pachi_web_session',
  password: process.env.WEB_SESSION_SECRET ?? 'local-development-session-secret-change-me-please-32',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  }
};

export async function webSession(): Promise<IronSession<WebSession>> {
  return getIronSession<WebSession>(await cookies(), sessionOptions);
}
