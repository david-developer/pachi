import type postgres from 'postgres';
import { IdentityError } from './identity.js';

export const INDIVIDUAL_PROVIDER_TYPES = ['OWNER', 'INDEPENDENT_AGENT', 'PROPERTY_MANAGER'] as const;
export type IndividualProviderType = typeof INDIVIDUAL_PROVIDER_TYPES[number];
export type ProviderOnboarding = { profileId: string; accountId: string; providerTypes: IndividualProviderType[]; state: 'DRAFT' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'CLOSED'; verificationStatus: 'NOT_VERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION'; displayName: string; bio: string | null; serviceArea: string | null };

export class ProviderStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async onboard(userId: string, input: { providerTypes: readonly IndividualProviderType[]; displayName: string; bio?: string; serviceArea?: string }): Promise<ProviderOnboarding> {
    const types = [...new Set(input.providerTypes)];
    if (!types.length || types.some((type) => !INDIVIDUAL_PROVIDER_TYPES.includes(type))) throw new IdentityError('PROVIDER_TYPE_INVALID', 'Provider type is invalid');
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 120) throw new IdentityError('PROVIDER_PROFILE_INVALID', 'Provider display name is invalid');
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`provider:${userId}`}, 0))`;
      const userRows = await transaction<{ account_state: string; phone_verified: boolean }[]>`SELECT account_state, EXISTS (SELECT 1 FROM phone_contacts WHERE user_id = ${userId} AND verified_at IS NOT NULL AND replaced_at IS NULL) AS phone_verified FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = userRows[0];
      if (!user) throw new IdentityError('ACCOUNT_NOT_FOUND', 'Account not found');
      if (user.account_state !== 'ACTIVE' || !user.phone_verified) throw new IdentityError('PROVIDER_ELIGIBILITY_REQUIRED', 'Active phone-confirmed account required');
      const profileRows = await transaction<{ id: string }[]>`
        INSERT INTO provider_profiles (user_id, provider_types, display_name, bio, service_area)
        VALUES (${userId}, ${types}, ${displayName}, ${input.bio?.trim() || null}, ${input.serviceArea?.trim() || null})
        ON CONFLICT (user_id) DO UPDATE SET provider_types = EXCLUDED.provider_types, display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, service_area = EXCLUDED.service_area, updated_at = now()
        RETURNING id
      `;
      const profile = profileRows[0];
      if (!profile) throw new IdentityError('PROVIDER_CREATE_FAILED', 'Provider profile could not be created');
      const accountRows = await transaction<{ id: string }[]>`
        INSERT INTO provider_accounts (provider_profile_id) VALUES (${profile.id})
        ON CONFLICT (provider_profile_id) DO UPDATE SET updated_at = now()
        RETURNING id
      `;
      const account = accountRows[0];
      if (!account) throw new IdentityError('PROVIDER_ACCOUNT_FAILED', 'Provider account could not be created');
      const result = await transaction<ProviderRow[]>`SELECT p.id AS profile_id, a.id AS account_id, p.provider_types, p.state, p.verification_status, p.display_name, p.bio, p.service_area FROM provider_profiles p JOIN provider_accounts a ON a.provider_profile_id = p.id WHERE p.id = ${profile.id}`;
      const row = result[0];
      if (!row) throw new IdentityError('PROVIDER_READ_FAILED', 'Provider profile could not be read');
      return mapProvider(row);
    });
  }

  public async get(userId: string): Promise<ProviderOnboarding | null> {
    const rows = await this.client<ProviderRow[]>`SELECT p.id AS profile_id, a.id AS account_id, p.provider_types, p.state, p.verification_status, p.display_name, p.bio, p.service_area FROM provider_profiles p JOIN provider_accounts a ON a.provider_profile_id = p.id WHERE p.user_id = ${userId}`;
    return rows[0] ? mapProvider(rows[0]) : null;
  }
}

type ProviderRow = { profile_id: string; account_id: string; provider_types: IndividualProviderType[]; state: ProviderOnboarding['state']; verification_status: ProviderOnboarding['verificationStatus']; display_name: string; bio: string | null; service_area: string | null };
function mapProvider(row: ProviderRow): ProviderOnboarding { return { profileId: row.profile_id, accountId: row.account_id, providerTypes: row.provider_types, state: row.state, verificationStatus: row.verification_status, displayName: row.display_name, bio: row.bio, serviceArea: row.service_area }; }
