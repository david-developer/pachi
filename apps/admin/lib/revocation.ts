import * as oidc from 'openid-client';

type Provider = { issuer: string; domain: string; clientId: string; clientSecret: string };
export async function revokeRefreshToken(
  provider: Provider,
  refresh: string,
  transport?: oidc.CustomFetch,
): Promise<void> {
  // Cognito's confidential-client revoke endpoint requires Basic authentication;
  // leave the established code-exchange/refresh configuration unchanged.
  const config = new oidc.Configuration(
    { issuer: provider.issuer, revocation_endpoint: new URL('/oauth2/revoke', provider.domain).href },
    provider.clientId,
    provider.clientSecret,
    oidc.ClientSecretBasic(provider.clientSecret),
  );
  config.timeout = 10;
  if (transport) config[oidc.customFetch] = transport;
  await oidc.tokenRevocation(config, refresh, { token_type_hint: 'refresh_token' });
}
export function safeRevocationFailure(error: unknown) {
  const e = error as { status?: unknown; error?: unknown; name?: unknown } | null;
  const status = typeof e?.status === 'number' && e.status >= 100 && e.status <= 599
    ? e.status : undefined;
  const reason = typeof e?.error === 'string' &&
    ['invalid_client', 'invalid_request', 'unsupported_token_type'].includes(e.error)
    ? e.error : status ? 'provider_http_error'
      : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'provider_timeout'
        : 'provider_request_failed';
  return { reason, http_status: status };
}
export async function revokeLocalThenProvider(
  id: string,
  local: (id: string) => Promise<string | null>,
  provider: (refresh: string) => Promise<void>,
  report: (event: Record<string, unknown>) => void,
): Promise<void> {
  const refresh = await local(id); // commit local denial before any network operation
  if (!refresh) return;
  const requestId = crypto.randomUUID();
  try {
    await provider(refresh);
    report({ event: 'staff_auth', stage: 'provider_revoke_response_accepted',
      request_id: requestId, observed_at: new Date().toISOString() });
  } catch (error) {
    report({ event: 'staff_auth', stage: 'provider_revoke_failed',
      request_id: requestId, observed_at: new Date().toISOString(), ...safeRevocationFailure(error) });
    // Provider failure must not prevent logout cookie clearing or new-session save.
  }
}
