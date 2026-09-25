import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError, type AccountState } from './identity.js';

export const PHONE_OWNERSHIP_PURPOSE = 'PHONE_OWNERSHIP' as const;
export const PHONE_CODE_TTL_MS = 5 * 60 * 1000;
export const PHONE_MAX_ATTEMPTS = 5;
export const PHONE_RESEND_COOLDOWN_MS = 60 * 1000;
export const PHONE_SEND_WINDOW_MS = 60 * 60 * 1000;
export const PHONE_MAX_SENDS_PER_WINDOW = 5;

export type PhoneChallenge = { id: string; userId: string; phone: string; code: string };
export type PhoneConfirmation = { userId: string; phone: string; accountState: AccountState; activated: boolean };

export class PhoneVerificationStore {
  public constructor(private readonly client: postgres.Sql, private readonly digestSecret: string) {}

  public async createChallenge(userId: string, phone: string, abuseKey = `${userId}:${phone}:local-test`): Promise<PhoneChallenge> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${phone}:${PHONE_OWNERSHIP_PURPOSE}`}, 0))`;
      const user = await transaction<{ account_state: AccountState }[]>`SELECT account_state FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!user[0]) throw new IdentityError('ACCOUNT_NOT_FOUND', 'Account not found');
      if (['SUSPENDED', 'LIMITED', 'DEACTIVATED', 'DELETION_PENDING', 'DELETED'].includes(user[0].account_state)) {
        throw new IdentityError('CAPABILITY_RESTRICTED', 'Phone verification is not available for this account');
      }

      const recent = await transaction<{ created_at: Date | string }[]>`
        SELECT created_at FROM phone_otp_challenges
        WHERE user_id = ${userId} AND normalized_e164 = ${phone} AND purpose = ${PHONE_OWNERSHIP_PURPOSE}
          AND created_at >= now() - interval '1 hour'
        ORDER BY created_at DESC
      `;
      const fingerprint = this.digestAbuseKey(abuseKey);
      const fingerprintRecent = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM phone_otp_challenges
        WHERE request_fingerprint_hash = ${fingerprint} AND created_at >= now() - interval '1 hour'
      `;
      const latest = recent[0];
      if (latest && Date.now() - timestampMs(latest.created_at) < PHONE_RESEND_COOLDOWN_MS) {
        throw new IdentityError('OTP_RESEND_COOLDOWN', 'Please wait before requesting another code');
      }
      if (recent.length >= PHONE_MAX_SENDS_PER_WINDOW || (fingerprintRecent[0]?.count ?? 0) >= PHONE_MAX_SENDS_PER_WINDOW) throw new IdentityError('OTP_RATE_LIMITED', 'Too many verification codes requested');

      await transaction`
        UPDATE phone_otp_challenges SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now()
        WHERE user_id = ${userId} AND normalized_e164 = ${phone} AND purpose = ${PHONE_OWNERSHIP_PURPOSE}
          AND status IN ('PENDING_DELIVERY', 'SENT')
      `;
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const digest = this.digest(code, phone, userId);
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO phone_otp_challenges (user_id, normalized_e164, purpose, code_digest, status, expires_at, request_fingerprint_hash)
        VALUES (${userId}, ${phone}, ${PHONE_OWNERSHIP_PURPOSE}, ${digest}, 'PENDING_DELIVERY', now() + interval '5 minutes', ${fingerprint})
        RETURNING id
      `;
      const row = rows[0];
      if (!row) throw new IdentityError('OTP_CREATE_FAILED', 'Verification challenge could not be created');
      return { id: row.id, userId, phone, code };
    });
  }

  public async markDelivery(challengeId: string, delivered: boolean, errorCode?: string): Promise<void> {
    await this.client`
      UPDATE phone_otp_challenges
      SET status = ${delivered ? 'SENT' : 'DELIVERY_FAILED'}, last_error_code = ${errorCode ?? null}, updated_at = now()
      WHERE id = ${challengeId} AND status = 'PENDING_DELIVERY'
    `;
  }

  public async confirm(userId: string, phone: string, challengeId: string, code: string): Promise<PhoneConfirmation> {
    const outcome = await this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${phone}:${PHONE_OWNERSHIP_PURPOSE}`}, 0))`;
      const challengeRows = await transaction<ChallengeRow[]>`
        SELECT id, user_id, normalized_e164, code_digest, status, attempts, max_attempts, expires_at
        FROM phone_otp_challenges WHERE id = ${challengeId} AND user_id = ${userId} AND normalized_e164 = ${phone} AND purpose = ${PHONE_OWNERSHIP_PURPOSE}
        FOR UPDATE
      `;
      const challenge = challengeRows[0];
      if (!challenge) throw new IdentityError('OTP_NOT_FOUND', 'Verification challenge not found');
      if (challenge.status !== 'SENT') throw new IdentityError('OTP_NOT_USABLE', 'Verification code is no longer usable');
      if (timestampMs(challenge.expires_at) <= Date.now()) {
        await transaction`UPDATE phone_otp_challenges SET status = 'EXPIRED', updated_at = now() WHERE id = ${challenge.id}`;
        return { error: new IdentityError('OTP_EXPIRED', 'Verification code expired') };
      }
      const expected = this.digest(code, phone, userId);
      if (expected.length !== challenge.code_digest.length || !timingSafeEqual(expected, challenge.code_digest)) {
        const attempts = challenge.attempts + 1;
        await transaction`UPDATE phone_otp_challenges SET attempts = ${attempts}, status = ${attempts >= challenge.max_attempts ? 'LOCKED' : 'SENT'}, updated_at = now() WHERE id = ${challenge.id}`;
        return { error: new IdentityError(attempts >= challenge.max_attempts ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID', 'Verification code is invalid') };
      }

      const userRows = await transaction<{ account_state: AccountState }[]>`SELECT account_state FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = userRows[0];
      if (!user || ['SUSPENDED', 'LIMITED', 'DEACTIVATED', 'DELETION_PENDING', 'DELETED'].includes(user.account_state)) {
        throw new IdentityError('CAPABILITY_RESTRICTED', 'Phone verification is not available for this account');
      }
      const owner = await transaction<{ user_id: string }[]>`SELECT user_id FROM phone_contacts WHERE normalized_e164 = ${phone} AND verified_at IS NOT NULL AND replaced_at IS NULL FOR UPDATE`;
      if (owner[0] && owner[0].user_id !== userId) throw new IdentityError('PHONE_ALREADY_OWNED', 'Phone ownership could not be established');

      await transaction`UPDATE phone_otp_challenges SET status = 'CONSUMED', consumed_at = now(), updated_at = now() WHERE id = ${challenge.id}`;
      if (owner[0]?.user_id === userId) {
        await transaction`UPDATE phone_contacts SET verified_at = COALESCE(verified_at, now()), verification_version = verification_version + 1 WHERE user_id = ${userId} AND normalized_e164 = ${phone} AND replaced_at IS NULL`;
      } else {
        await transaction`INSERT INTO phone_contacts (user_id, normalized_e164, verified_at, verification_version) VALUES (${userId}, ${phone}, now(), 1)`;
      }
      let activated = false;
      if (user.account_state === 'PENDING_PHONE') {
        await transaction`UPDATE users SET account_state = 'ACTIVE', updated_at = now() WHERE id = ${userId} AND account_state = 'PENDING_PHONE'`;
        activated = true;
      }
      await transaction`
        INSERT INTO audit_events (actor_user_id, action, target_type, target_id, reason_code, safe_metadata)
        VALUES (${userId}, 'PHONE_OWNERSHIP_VERIFIED', 'PhoneContact', ${phoneAuditTarget(phone)}, 'OTP_CONFIRMED', jsonb_build_object('purpose', ${PHONE_OWNERSHIP_PURPOSE}::text))
      `;
      return { result: { userId, phone, accountState: activated ? 'ACTIVE' : user.account_state, activated } };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }

  private digest(code: string, phone: string, userId: string): Buffer {
    return createHmac('sha256', this.digestSecret).update(`${PHONE_OWNERSHIP_PURPOSE}:${userId}:${phone}:${code}`).digest();
  }

  private digestAbuseKey(abuseKey: string): Buffer {
    return createHmac('sha256', this.digestSecret).update(`PHONE_ABUSE:${abuseKey}`).digest();
  }
}

function phoneAuditTarget(phone: string): string {
  return `sha256:${createHash('sha256').update(phone).digest('hex').slice(0, 24)}`;
}

function timestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

type ChallengeRow = { id: string; user_id: string; normalized_e164: string; code_digest: Buffer; status: string; attempts: number; max_attempts: number; expires_at: Date | string };
