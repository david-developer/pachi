import type postgres from 'postgres';
import { IdentityError } from './identity.js';

/** Foundation permission boundary. No organization business operation is exposed. */
export class OrganizationAccessStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async requireSettingsAccess(userId: string, organizationId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Organization access denied');
    }
    // Re-read membership and account on EVERY request; never trust role claims,
    // browser projections, or membership captured when the session was created.
    const rows = await this.client`
      SELECT m.id FROM organization_memberships m
      JOIN organizations o ON o.id=m.organization_id
      JOIN users u ON u.id=m.user_id
      WHERE m.user_id=${userId} AND m.organization_id=${organizationId}
        AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN')
        AND o.state='ACTIVE' AND u.account_state='ACTIVE'
        AND EXISTS (SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL)
    `;
    if (!rows.length) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Organization access denied');
  }
}
