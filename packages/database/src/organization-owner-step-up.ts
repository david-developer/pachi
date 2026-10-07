import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import type { OrganizationActor } from './organization-lifecycle.js';

const lifetime = 15 * 60_000;
/** Server-only synthetic MFA evidence. No HTTP enrollment/evidence endpoint exists.
 * Production has no trusted owner step-up adapter yet and fails closed (E07).
 * This harness cannot attach evidence to a Cognito/real/non-TEST session. */
export class LocalOrganizationOwnerStepUp {
  private readonly evidence = new Map<string, { at: number; securityVersion: number }>();
  constructor(private readonly client: postgres.Sql, private readonly clock = () => new Date()) {
    this.guard();
  }
  private guard(): void {
    const options = this.client.options;
    if (process.env.NODE_ENV !== 'test' || options.host.length !== 1 || options.host[0] !== 'localhost'
      || Number(options.port[0]) !== 5433 || options.database !== 'pachi_test') throw new IdentityError('STEP_UP_REQUIRED', 'STEP_UP_REQUIRED');
  }
  private key(actor: OrganizationActor, organizationId: string): string {
    return `${actor.userId.toLowerCase()}:${actor.sessionId.toLowerCase()}:${organizationId.toLowerCase()}`;
  }
  async establish(actor: OrganizationActor, organizationId: string): Promise<void> {
    this.guard();
    const rows = await this.client`SELECT s.id FROM security_sessions s JOIN users u ON u.id=s.user_id
      JOIN auth_identities i ON i.user_id=u.id AND i.issuer=s.issuer AND i.provider='LOCAL_TEST' AND i.unlinked_at IS NULL
      WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.issuer LIKE 'https://local.test/%'
      AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND u.security_version=${actor.securityVersion}`;
    if (!rows[0]) throw new IdentityError('STEP_UP_REQUIRED', 'STEP_UP_REQUIRED');
    this.evidence.set(this.key(actor, organizationId), { at: +this.clock(), securityVersion: actor.securityVersion });
  }
  async require(tx: postgres.TransactionSql, actor: OrganizationActor, organizationId: string): Promise<void> {
    this.guard();
    const evidence = this.evidence.get(this.key(actor, organizationId)), now = +this.clock();
    if (!evidence || evidence.securityVersion !== actor.securityVersion || evidence.at > now || now - evidence.at >= lifetime)
      throw new IdentityError('STEP_UP_REQUIRED', 'STEP_UP_REQUIRED');
    const rows = await tx`SELECT s.id FROM security_sessions s JOIN auth_identities i ON i.user_id=s.user_id
      AND i.issuer=s.issuer AND i.provider='LOCAL_TEST' AND i.unlinked_at IS NULL
      WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.issuer LIKE 'https://local.test/%'`;
    if (!rows[0]) throw new IdentityError('STEP_UP_REQUIRED', 'STEP_UP_REQUIRED');
  }
}
