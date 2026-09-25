import * as oidc from 'openid-client';

export const WEB_AUTH_SCOPE = 'openid email profile pachi/account';

export function oidcConfigured(): boolean {
  return Boolean(process.env.COGNITO_ISSUER && process.env.COGNITO_CLIENT_ID && process.env.COGNITO_CLIENT_SECRET && process.env.COGNITO_REDIRECT_URI);
}

export async function oidcConfiguration(): Promise<oidc.Configuration> {
  const issuer = process.env.COGNITO_ISSUER;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) throw new Error('Cognito web configuration is incomplete');
  return oidc.discovery(new URL(issuer), clientId, clientSecret);
}

export function redirectUri(): string {
  return process.env.COGNITO_REDIRECT_URI ?? 'http://localhost:3000/api/auth/callback';
}

export function cognitoLogoutUrl(): string | null {
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const logoutUri = process.env.COGNITO_LOGOUT_URI;
  if (!domain || !clientId || !logoutUri) return null;
  const url = new URL('/logout', domain);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('logout_uri', logoutUri);
  return url.toString();
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
