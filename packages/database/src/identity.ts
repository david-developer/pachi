import type postgres from 'postgres';

export type AccountState = 'PENDING_PHONE' | 'ACTIVE' | 'LIMITED' | 'SUSPENDED' | 'DEACTIVATED' | 'DELETION_PENDING' | 'DELETED';
export type IdentityProvider = 'COGNITO' | 'LOCAL_TEST';

export type VerifiedTokenClaims = {
  issuer: string;
  subject: string;
  clientId: string;
  originJti: string;
  jti: string;
  expiresAt: Date;
  issuedAt: Date;
  scopes: string[];
  provider: IdentityProvider;
};

export type SessionRecord = {
  id: string;
  userId: string;
  accountState: AccountState;
  securityVersion: number;
  issuer: string;
  appClientId: string;
  originJti: string;
  currentJti: string;
  authenticatedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type SafeSession = {
  id: string;
  authenticated_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  current: boolean;
};

export type AuthenticatedPrincipal = {
  userId: string;
  session: SessionRecord;
};

export class IdentityStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async bootstrap(claims: VerifiedTokenClaims, deviceLabel?: string): Promise<AuthenticatedPrincipal> {
    return this.client.begin(async (transaction) => {
      // Serialize bootstrap for one external identity before the unique mapping is resolved.
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${claims.issuer}:${claims.subject}`}, 0))`;
      const existingIdentity = await transaction<{
        user_id: string;
        unlinked_at: Date | null;
      }[]>`SELECT user_id, unlinked_at FROM auth_identities WHERE issuer = ${claims.issuer} AND subject = ${claims.subject} FOR UPDATE`;

      let userId: string;
      if (existingIdentity[0]?.unlinked_at) {
        throw new IdentityError('IDENTITY_UNLINKED', 'The identity is no longer linked');
      }
      if (existingIdentity[0]) {
        userId = existingIdentity[0].user_id;
      } else {
        const createdUser = await transaction<{ id: string }[]>`INSERT INTO users DEFAULT VALUES RETURNING id`;
        const newUser = createdUser[0];
        if (!newUser) throw new IdentityError('ACCOUNT_CREATE_FAILED', 'Account could not be created');
        userId = newUser.id;
        await transaction`
          INSERT INTO auth_identities (user_id, issuer, subject, provider)
          VALUES (${userId}, ${claims.issuer}, ${claims.subject}, ${claims.provider})
          ON CONFLICT (issuer, subject) DO NOTHING
        `;
        const resolvedIdentity = await transaction<{ user_id: string }[]>`SELECT user_id FROM auth_identities WHERE issuer = ${claims.issuer} AND subject = ${claims.subject} FOR UPDATE`;
        const identity = resolvedIdentity[0];
        if (!identity) throw new IdentityError('IDENTITY_CREATE_FAILED', 'Identity could not be linked');
        userId = identity.user_id;
      }

      const existingSession = await transaction<{ id: string; revoked_at: Date | null }[]>`
        SELECT id, revoked_at FROM security_sessions
        WHERE user_id = ${userId} AND issuer = ${claims.issuer} AND app_client_id = ${claims.clientId} AND origin_jti = ${claims.originJti}
        FOR UPDATE
      `;
      if (existingSession[0]?.revoked_at) {
        throw new IdentityError('SESSION_REVOKED', 'The session has been revoked');
      }

      let sessionId: string;
      if (existingSession[0]) {
        sessionId = existingSession[0].id;
        await transaction`
          UPDATE security_sessions
          SET current_jti = ${claims.jti}, last_seen_at = now(), expires_at = ${claims.expiresAt.toISOString()}, device_label = COALESCE(${deviceLabel ?? null}, device_label)
          WHERE id = ${sessionId}
        `;
      } else {
        const createdSession = await transaction<{ id: string }[]>`
          INSERT INTO security_sessions (user_id, issuer, app_client_id, origin_jti, current_jti, device_label, authenticated_at, last_seen_at, expires_at)
          VALUES (${userId}, ${claims.issuer}, ${claims.clientId}, ${claims.originJti}, ${claims.jti}, ${deviceLabel ?? null}, ${claims.issuedAt.toISOString()}, now(), ${claims.expiresAt.toISOString()})
          RETURNING id
        `;
        const newSession = createdSession[0];
        if (!newSession) throw new IdentityError('SESSION_CREATE_FAILED', 'Session could not be registered');
        sessionId = newSession.id;
      }

      const principal = await this.readPrincipal(transaction, userId, sessionId);
      if (!principal) throw new IdentityError('ACCOUNT_NOT_FOUND', 'Account not found');
      return principal;
    });
  }

  public async readPrincipal(transaction: postgres.Sql, userId: string, sessionId: string): Promise<AuthenticatedPrincipal | null> {
    const rows = await transaction<SessionRow[]>`
      SELECT s.id, s.user_id, u.account_state, u.security_version, s.issuer, s.app_client_id, s.origin_jti, s.current_jti,
             s.authenticated_at, s.last_seen_at, s.expires_at, s.revoked_at
      FROM security_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ${sessionId} AND s.user_id = ${userId}
    `;
    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at <= new Date() || ['SUSPENDED', 'DELETED'].includes(row.account_state)) return null;
    return { userId: row.user_id, session: toSession(row) };
  }

  public async listSessions(userId: string, currentSessionId: string): Promise<SafeSession[]> {
    const rows = await this.client<SessionRow[]>`
      SELECT id, user_id, account_state, security_version, issuer, app_client_id, origin_jti, current_jti,
             authenticated_at, last_seen_at, expires_at, revoked_at
      FROM security_sessions WHERE user_id = ${userId} ORDER BY last_seen_at DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      authenticated_at: row.authenticated_at.toISOString(),
      last_seen_at: row.last_seen_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      revoked_at: row.revoked_at?.toISOString() ?? null,
      current: row.id === currentSessionId
    }));
  }

  public async revokeSession(userId: string, sessionId: string, reason: string): Promise<boolean> {
    const result = await this.client`
      UPDATE security_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, ${reason})
      WHERE user_id = ${userId} AND id = ${sessionId}
    `;
    return result.count > 0;
  }

  public async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.client.begin(async (transaction) => {
      await transaction`UPDATE users SET security_version = security_version + 1, updated_at = now() WHERE id = ${userId}`;
      await transaction`UPDATE security_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, ${reason}) WHERE user_id = ${userId}`;
    });
  }

  public async currentUser(userId: string): Promise<{ id: string; accountState: AccountState; securityVersion: number; phoneVerified: boolean } | null> {
    const rows = await this.client<{ id: string; account_state: AccountState; security_version: number; phone_verified: boolean }[]>`
      SELECT u.id, u.account_state, u.security_version, EXISTS (
        SELECT 1 FROM phone_contacts p WHERE p.user_id = u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL
      ) AS phone_verified
      FROM users u WHERE u.id = ${userId}
    `;
    const row = rows[0];
    return row ? { id: row.id, accountState: row.account_state, securityVersion: row.security_version, phoneVerified: row.phone_verified } : null;
  }
}

type SessionRow = {
  id: string; user_id: string; account_state: AccountState; security_version: number; issuer: string; app_client_id: string;
  origin_jti: string; current_jti: string; authenticated_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
};

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id, userId: row.user_id, accountState: row.account_state, securityVersion: row.security_version,
    issuer: row.issuer, appClientId: row.app_client_id, originJti: row.origin_jti, currentJti: row.current_jti,
    authenticatedAt: row.authenticated_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, revokedAt: row.revoked_at
  };
}

export class IdentityError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); }
}
