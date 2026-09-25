import type { AuthBootstrapResponse, PhoneConfirmResponse, PhoneRequestResponse } from '@pachi/contracts';

const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

async function apiRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, ...init?.headers },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`API_${response.status}`);
  return response.json() as Promise<T>;
}

export function bootstrap(accessToken: string): Promise<AuthBootstrapResponse> {
  return apiRequest('/v1/auth/bootstrap', accessToken, { method: 'POST', body: '{}' });
}

export function requestPhone(accessToken: string, phone: string): Promise<PhoneRequestResponse> {
  return apiRequest('/v1/account/phone/request', accessToken, { method: 'POST', body: JSON.stringify({ phone }) });
}

export function confirmPhone(accessToken: string, phone: string, challengeId: string, code: string): Promise<PhoneConfirmResponse> {
  return apiRequest('/v1/account/phone/confirm', accessToken, { method: 'POST', body: JSON.stringify({ phone, challenge_id: challengeId, code }) });
}

export function revokeSession(accessToken: string, all = false): Promise<{ status: 'ok' }> {
  return apiRequest(all ? '/v1/account/logout-all' : '/v1/account/logout', accessToken, { method: 'POST', body: '{}' });
}
