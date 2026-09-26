import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import type { VerifiedTokenClaims } from './identity.js';
import {
  StaffAccessError,
  validStaffScope,
  type StaffRole,
  type StaffScope,
} from './staff-policy.js';

type Grant = { role: StaffRole; scope: StaffScope; expires_at: string };
type Row = {
  id: string;
  user_id: string;
  identity_id: string;
  issuer: string;
  app_client_id: string;
  origin_jti: string;
  authenticated_at: Date;
  absolute_expires_at: Date;
  idle_expires_at: Date;
  token_expires_at: Date;
  access_token_ciphertext: Buffer;
  refresh_token_ciphertext: Buffer;
  display_name: string | null;
};
export type StaffPrincipal = { row: Row; grants: Grant[] };
export class StaffStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly secret?: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private cipher(value: string | Buffer): Buffer | string {
    if (!this.secret || this.secret.length < 32) throw new StaffAccessError('CONFIGURATION');
    const key = createHash('sha256').update(this.secret).digest();
    if (typeof value === 'string') {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ciphertext]);
    }
    const d = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    d.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([d.update(value.subarray(28)), d.final()]).toString('utf8');
  }
  async audit(
    actor: string,
    target: string | null,
    action: string,
    reason: string,
    outcome: string,
    role: string | null = null,
    scope: StaffScope | null = null,
  ): Promise<void> {
    await this
      .client`INSERT INTO staff_access_audit(actor,target_user_id,action,reason,outcome,role,permission_scope,request_id)
      VALUES (${actor},${target},${action},${reason},${outcome},${role},${scope ? JSON.stringify(scope) : null}::jsonb,${randomUUID()})`;
  }
  async beginLogin(): Promise<string> {
    const now = this.clock();
    const rows = await this.client<
      { id: string }[]
    >`INSERT INTO staff_auth_transactions(started_at,expires_at) VALUES (${now.toISOString()},${new Date(+now + 600_000).toISOString()}) RETURNING id`;
    return rows[0]!.id;
  }
  async consumeLogin(id: string): Promise<Date> {
    const rows = await this.client<
      { started_at: Date }[]
    >`UPDATE staff_auth_transactions SET consumed_at=${this.clock().toISOString()} WHERE id=${id} AND consumed_at IS NULL AND expires_at>${this.clock().toISOString()} RETURNING started_at`;
    if (!rows[0]) throw new StaffAccessError('AUTH_REQUIRED');
    return new Date(rows[0].started_at);
  }
  async grants(userId: string): Promise<Grant[]> {
    const now = this.clock();
    const rows = await this.client<
      { role: StaffRole; permission_scope: StaffScope; expires_at: Date }[]
    >`SELECT role,permission_scope,expires_at FROM staff_grants WHERE user_id=${userId} AND revoked_at IS NULL AND active_from<=${now.toISOString()} AND expires_at>${now.toISOString()}`;
    return rows
      .filter((r) => validStaffScope(r.role, r.permission_scope))
      .map((r) => ({
        role: r.role,
        scope: r.permission_scope,
        expires_at: new Date(r.expires_at).toISOString(),
      }));
  }
  // Called only by the confidential admin callback after provider verification.
  // There is deliberately no bearer-token bootstrap/MFA-flag API.
  async register(
    claims: VerifiedTokenClaims,
    authenticatedAt: Date,
    access: string,
    refresh: string,
  ): Promise<string> {
    const now = this.clock();
    if (
      !Number.isFinite(+authenticatedAt) ||
      authenticatedAt > now ||
      +now - +authenticatedAt > 600_000 ||
      claims.expiresAt <= now
    )
      throw new StaffAccessError('AUTH_REQUIRED');
    const identities = await this.client<
      { id: string; user_id: string; security_version: number }[]
    >`SELECT i.id,i.user_id,u.security_version FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=${claims.issuer} AND i.subject=${claims.subject} AND i.unlinked_at IS NULL AND u.account_state IN ('ACTIVE','PENDING_PHONE')`;
    const i = identities[0];
    if (!i || !(await this.grants(i.user_id)).length) {
      await this.audit(
        'staff-callback',
        i?.user_id ?? null,
        'staff:login',
        'NO_ELIGIBLE_GRANT',
        'DENIED',
      );
      throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
    }
    const absolute = new Date(+authenticatedAt + 8 * 3600_000);
    const rows = await this.client<
      { id: string }[]
    >`INSERT INTO staff_sessions(user_id,identity_id,issuer,app_client_id,origin_jti,security_version,authenticated_at,mfa_method,last_seen_at,absolute_expires_at,idle_expires_at,token_expires_at,access_token_ciphertext,refresh_token_ciphertext)
      VALUES (${i.user_id},${i.id},${claims.issuer},${claims.clientId},${claims.originJti},${i.security_version},${authenticatedAt.toISOString()},'COGNITO_REQUIRED_TOTP',${now.toISOString()},${absolute.toISOString()},${new Date(Math.min(+now + 1800_000, +absolute)).toISOString()},${claims.expiresAt.toISOString()},${this.cipher(access) as Buffer},${this.cipher(refresh) as Buffer})
      ON CONFLICT (issuer,app_client_id,origin_jti) DO NOTHING RETURNING id`;
    if (!rows[0]) throw new StaffAccessError('AUTH_REQUIRED');
    await this.audit(i.user_id, i.user_id, 'staff:login', 'FRESH_REQUIRED_TOTP', 'SUCCESS');
    return rows[0].id;
  }
  async read(id: string, touch = true): Promise<StaffPrincipal> {
    const now = this.clock();
    const rows = await this.client<
      Row[]
    >`SELECT s.*,u.display_name FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id
      WHERE s.id=${id} AND s.revoked_at IS NULL AND s.absolute_expires_at>${now.toISOString()} AND s.idle_expires_at>${now.toISOString()}
      AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=${now.toISOString()}
      AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND u.security_version=s.security_version
      AND i.unlinked_at IS NULL AND i.user_id=s.user_id AND i.issuer=s.issuer`;
    const row = rows[0];
    if (!row) throw new StaffAccessError('AUTH_REQUIRED');
    for (const key of [
      'authenticated_at',
      'absolute_expires_at',
      'idle_expires_at',
      'token_expires_at',
    ] as const)
      row[key] = new Date(row[key]);
    const grants = await this.grants(row.user_id);
    if (!grants.length) throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
    if (touch) {
      row.idle_expires_at = new Date(Math.min(+now + 1800_000, +row.absolute_expires_at));
      await this
        .client`UPDATE staff_sessions SET last_seen_at=${now.toISOString()},idle_expires_at=${row.idle_expires_at.toISOString()} WHERE id=${id} AND revoked_at IS NULL`;
    }
    return { row, grants };
  }
  async authenticate(claims: VerifiedTokenClaims): Promise<StaffPrincipal> {
    const rows = await this.client<
      { id: string }[]
    >`SELECT s.id FROM staff_sessions s JOIN auth_identities i ON i.id=s.identity_id WHERE s.issuer=${claims.issuer} AND s.app_client_id=${claims.clientId} AND s.origin_jti=${claims.originJti} AND i.subject=${claims.subject}`;
    if (!rows[0] || claims.expiresAt <= this.clock()) throw new StaffAccessError('AUTH_REQUIRED');
    return this.read(rows[0].id);
  }
  projection(p: StaffPrincipal) {
    return {
      display_name: p.row.display_name ?? 'Staff member',
      grants: p.grants,
      absolute_expires_at: p.row.absolute_expires_at.toISOString(),
      idle_expires_at: p.row.idle_expires_at.toISOString(),
      reauthentication_expires_at: new Date(+p.row.authenticated_at + 900_000).toISOString(),
    };
  }
  async tokens(
    id: string,
    refresh: (
      access: string,
      refresh: string,
    ) => Promise<{ access: string; refresh: string; expiresAt: Date; claims: VerifiedTokenClaims }>,
  ): Promise<string> {
    // DB lock coordinates rotation across processes/instances. No stale token write.
    return this.client
      .begin(async (tx) => {
        await tx`SELECT id FROM staff_sessions WHERE id=${id} FOR UPDATE`;
        const store = new StaffStore(tx as unknown as postgres.Sql, this.secret, this.clock);
        const { row } = await store.read(id, false);
        const access = store.cipher(row.access_token_ciphertext) as string;
        if (+row.token_expires_at > +this.clock() + 30_000) return access;
        try {
          const next = await refresh(access, store.cipher(row.refresh_token_ciphertext) as string);
          if (
            next.claims.issuer !== row.issuer ||
            next.claims.clientId !== row.app_client_id ||
            next.claims.originJti !== row.origin_jti
          )
            throw new StaffAccessError('AUTH_REQUIRED');
          const identities = await tx<
            { subject: string }[]
          >`SELECT subject FROM auth_identities WHERE id=${row.identity_id}`;
          if (next.claims.subject !== identities[0]?.subject)
            throw new StaffAccessError('AUTH_REQUIRED');
          await tx`UPDATE staff_sessions SET access_token_ciphertext=${store.cipher(next.access) as Buffer},refresh_token_ciphertext=${store.cipher(next.refresh) as Buffer},token_expires_at=${next.expiresAt.toISOString()} WHERE id=${id}`;
          return next.access;
        } catch {
          await tx`UPDATE staff_sessions SET revoked_at=${this.clock().toISOString()} WHERE id=${id}`;
          await store.audit(
            row.user_id,
            row.user_id,
            'staff:session_revoke',
            'REFRESH_FAILED',
            'SUCCESS',
          );
          return ''; // commit revocation, then caller rejects empty token
        }
      })
      .then((token) => {
        if (!token) throw new StaffAccessError('AUTH_REQUIRED');
        return token;
      });
  }
  async revoke(id: string): Promise<string | null> {
    const rows = await this.client<
      { user_id: string; refresh_token_ciphertext: Buffer }[]
    >`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,${this.clock().toISOString()}) WHERE id=${id} RETURNING user_id,refresh_token_ciphertext`;
    if (!rows[0]) return null;
    await this.audit(rows[0].user_id, rows[0].user_id, 'staff:logout', 'USER_LOGOUT', 'SUCCESS');
    return this.secret ? (this.cipher(rows[0].refresh_token_ciphertext) as string) : null;
  }
  async provision(input: {
    operator: string;
    userId: string;
    issuer: string;
    subject: string;
    role: StaffRole;
    scope: StaffScope;
    reason: string;
    expiresAt: Date;
  }): Promise<string> {
    if (
      !input.operator.trim() ||
      input.reason.trim().length < 10 ||
      !validStaffScope(input.role, input.scope) ||
      input.expiresAt <= this.clock()
    )
      throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
    return this.client
      .begin(async (tx) => {
        const mapped =
          await tx`SELECT i.id FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=${input.userId} AND i.issuer=${input.issuer} AND i.subject=${input.subject} AND i.unlinked_at IS NULL AND u.account_state IN ('ACTIVE','PENDING_PHONE') FOR UPDATE`;
        const store = new StaffStore(tx as unknown as postgres.Sql, this.secret, this.clock);
        if (!mapped.length) {
          await store.audit(
            input.operator,
            input.userId,
            'staff:grant',
            input.reason,
            'DENIED',
            input.role,
            input.scope,
          );
          return '';
        }
        const rows = await tx<
          { id: string }[]
        >`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason,active_from) VALUES (${input.userId},${input.role},${JSON.stringify(input.scope)}::jsonb,${input.expiresAt.toISOString()},${input.operator},${input.reason},${this.clock().toISOString()}) RETURNING id`;
        await tx`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,${this.clock().toISOString()}) WHERE user_id=${input.userId}`;
        await store.audit(
          input.operator,
          input.userId,
          'staff:grant',
          input.reason,
          'SUCCESS',
          input.role,
          input.scope,
        );
        return rows[0]!.id;
      })
      .then((id) => {
        if (!id) throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
        return id;
      });
  }
}
