'use client';
import { useEffect, useState } from 'react';
import type { StaffSessionResponse } from '@pachi/contracts';
export default function Page() {
  const [session, setSession] = useState<StaffSessionResponse | null>(null),
    [csrf, setCsrf] = useState(''),
    [status, setStatus] = useState('Loading staff session…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/session', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json();
        if (!alive) return;
        setCsrf(b.csrf ?? '');
        if (r.ok) {
          setSession(b.session);
          setCsrf(b.csrf);
          setStatus('Signed in');
        } else
          setStatus(
            b.error === 'CONFIGURATION'
              ? 'Staff sign-in is not configured. Contact the operator.'
              : b.error === 'ACCESS_DENIED'
                ? 'Access denied. An eligible staff grant is required.'
                : 'Signed out or session expired.',
          );
      })
      .catch(() => {
        if (alive) setStatus('Unable to check staff access. Try again.');
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const deadline = Math.min(
      Date.parse(session.idle_expires_at),
      Date.parse(session.absolute_expires_at),
    );
    const timer = setTimeout(
      () => {
        setSession(null);
        setStatus('Session expired. Sign in again.');
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  async function logout() {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
      });
      if (!r.ok) throw new Error();
      const b = await r.json();
      window.location.assign(b.logout_url);
    } catch {
      setStatus('Sign-out failed. Please retry.');
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>Pachi staff access</h1>
      <p role="status">{status}</p>
      <AuthError />
      {session ? (
        <>
          <h2>{session.display_name}</h2>
          <ul>
            {session.grants.map((g, i) => (
              <li key={i}>
                {g.role} — {g.scope.kind}: {g.scope.id}
                <br />
                {g.scope.permissions.join(', ')}
                <br />
                Grant expires {g.expires_at}
              </li>
            ))}
          </ul>
          <p>
            Session expires {session.absolute_expires_at}. Idle deadline {session.idle_expires_at}.
          </p>
          <p>
            Recent authentication valid until {session.reauthentication_expires_at}. Sensitive
            actions require reauthentication within 15 minutes.
          </p>
        </>
      ) : null}
      {csrf ? (
        <button
          disabled={busy}
          onClick={() => {
            void logout();
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      ) : null}
      <form action="/api/auth/login" method="post">
        <button>{session ? 'Reauthenticate with TOTP' : 'Sign in with staff account'}</button>
      </form>
      <p>
        Use your local staff Cognito account and authenticator. Marketplace sign-in and organization
        roles do not grant staff access.
      </p>
    </main>
  );
}
function AuthError() {
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get('auth_error');
    if (code)
      setError(
        code === 'access_denied'
          ? 'Access denied: no eligible staff grant.'
          : code === 'configuration'
            ? 'Staff authentication configuration is incomplete.'
            : 'Authentication could not be verified. Sign in again with password and TOTP; contact the operator if it persists.',
      );
  }, []);
  return error ? <p role="alert">{error}</p> : null;
}
