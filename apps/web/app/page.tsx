'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type SessionState = { authenticated: boolean; expired?: boolean; userId?: string; accountState?: string; participationAllowed?: boolean; csrfToken?: string };
type ProviderState = { provider: null } | { profile_id: string; account_id: string; provider_types: string[]; state: string; verification_status: string; display_name: string; bio: string | null; service_area: string | null };

const copy = { title: 'Pachi marketplace', signedOut: 'Sign in to continue', signIn: 'Continue with Pachi', pending: 'Confirm your phone to unlock marketplace participation.', active: 'Your account is ready for marketplace participation.', phoneLabel: 'Cameroon phone number', phoneHint: '+237 690 000 001', request: 'Send verification code', confirm: 'Confirm phone', codeLabel: 'Six-digit code', logout: 'Sign out', logoutAll: 'Sign out everywhere' } as const;

export default function MarketplaceShell() {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<ProviderState | null>(null);
  const [providerTypes, setProviderTypes] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [serviceArea, setServiceArea] = useState('');

  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' }).then((response) => response.json() as Promise<SessionState>).then((nextState) => { setState(nextState); if (nextState.authenticated) fetch('/api/account/provider', { cache: 'no-store' }).then((response) => response.json() as Promise<ProviderState>).then(setProvider).catch(() => setError('The provider profile could not be loaded.')); }).catch(() => setError('The session could not be checked. Refresh and try again.'));
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (authError) setError(authError === 'configuration' ? 'Web authentication is not configured for this environment.' : 'Authentication could not be completed. Try again.');
  }, []);

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    if (!state?.csrfToken) return;
    setBusy(true); setError(null);
    try {
      const path = challengeId ? '/api/account/phone/confirm' : '/api/account/phone/request';
      const body = challengeId ? { phone, challenge_id: challengeId, code } : { phone };
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrfToken }, body: JSON.stringify(body) });
      const result = await response.json() as { challengeId?: string };
      if (!response.ok) throw new Error('phone_failed');
      if (challengeId) { setState({ ...state, accountState: 'ACTIVE', participationAllowed: true }); setChallengeId(''); setCode(''); }
      else if (result.challengeId) setChallengeId(result.challengeId);
    } catch { setError(challengeId ? 'That code is invalid, expired, or no longer usable. Request a new code and try again.' : 'We could not send a verification code. Check the number or wait before trying again.'); }
    finally { setBusy(false); }
  }

  async function onboardProvider(event: FormEvent) { event.preventDefault(); if (!state?.csrfToken || !providerTypes.length) return; setBusy(true); setError(null); try { const response = await fetch('/api/account/provider', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrfToken }, body: JSON.stringify({ provider_types: providerTypes, display_name: displayName, service_area: serviceArea }) }); const result = await response.json() as ProviderState & { error?: string }; if (!response.ok) throw new Error(result.error ?? 'provider_failed'); setProvider(result); } catch { setError('Provider onboarding could not be saved. Confirm your account is ACTIVE and phone-confirmed.'); } finally { setBusy(false); } }

  async function logout(all: boolean) {
    const csrfToken = state?.csrfToken;
    if (!csrfToken) return;
    await fetch(`/api/auth/logout${all ? '?all=true' : ''}`, { method: 'POST', headers: { origin: window.location.origin, 'x-csrf-token': csrfToken } });
    window.location.href = '/';
  }

  if (!state) return <main className="shell"><section className="panel"><p className="eyebrow">PACHI / MARKETPLACE</p><h1>Checking your session</h1><p className="muted">Authentication status is loading.</p></section></main>;
  if (!state.authenticated) return <main className="shell"><section className="panel"><p className="eyebrow">PACHI / MARKETPLACE</p><h1>{copy.title}</h1><p className="muted">{copy.signedOut}. This is the development web authentication shell.</p>{error && <p className="error" role="alert">{error}</p>}<button className="primary" onClick={() => { window.location.href = '/api/auth/login?returnTo=/'; }}>{copy.signIn}</button></section></main>;
  return <main className="shell"><section className="panel"><div className="topline"><p className="eyebrow">PACHI / MARKETPLACE</p><button className="linkButton" onClick={() => { void logout(false); }}>{copy.logout}</button></div><h1>Welcome back</h1><p className="muted">Account state: <strong>{state.accountState}</strong></p>{error && <p className="error" role="alert">{error}</p>}{state.participationAllowed ? <div className="success"><h2>{copy.active}</h2><p>Participation permissions are checked by the backend on every request.</p><button className="secondary" onClick={() => { void logout(true); }}>{copy.logoutAll}</button></div> : <div className="verification"><h2>{copy.pending}</h2><p className="muted">Phone ownership is a separate claim from sign-in identity.</p><form onSubmit={(event) => { void submitPhone(event); }}><label>{copy.phoneLabel}<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={copy.phoneHint} autoComplete="tel" required /></label>{challengeId && <label>{copy.codeLabel}<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required /></label>}<button className="primary" disabled={busy}>{busy ? 'Working…' : challengeId ? copy.confirm : copy.request}</button></form><p className="fineprint">Codes expire after five minutes. Resends are limited and cooldown-protected.</p></div>}{state.participationAllowed && <div className="verification"><h2>Provider profile</h2>{provider && 'provider_types' in provider ? <p className="muted">{provider.display_name} · {provider.provider_types.join(', ')} · {provider.verification_status}</p> : <form onSubmit={(event) => { void onboardProvider(event); }}><label>Provider types<select multiple value={providerTypes} onChange={(event) => setProviderTypes(Array.from(event.target.selectedOptions, (option) => option.value))}><option value="OWNER">Owner</option><option value="INDEPENDENT_AGENT">Independent agent</option><option value="PROPERTY_MANAGER">Property manager</option></select></label><label>Public provider name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Service area<input value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} placeholder="City or region" /></label><button className="primary" disabled={busy || !providerTypes.length}>{busy ? 'Saving…' : 'Start provider onboarding'}</button></form>}</div>}</section></main>;
}
