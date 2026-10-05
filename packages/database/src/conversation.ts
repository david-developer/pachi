import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import {
  conversationActorPredicate,
  conversationListingProjection,
  isUuid,
  requireConversationAccess,
  type ConversationContext
} from './conversation-access.js';

type Sql = postgres.Sql | postgres.TransactionSql;
type Side = 'SEEKER' | 'PROVIDER';
type Receipt = {
  recipient_user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_side: Side;
  client_message_id: string;
  body: string;
  sequence: string;
  sent_at: Date;
  visibility_state: 'VISIBLE' | 'REMOVED';
};
export type SafeMessage = Omit<MessageRow, 'sent_at' | 'body'> & {
  sent_at: string;
  body: string | null;
  receipts: Receipt[];
};
export const MESSAGE_LIMIT_DEFAULTS = Object.freeze({
  conversation: 20,
  global: 60,
  windowSeconds: 60
});
export type MessageLimits = {
  conversation: number;
  global: number;
  windowSeconds: number;
};
export const RESPONSE_BUCKET_VERSION = 1;
export function responseTimeBucket(
  milliseconds: number
): 'LT_5M' | 'M5_TO_15M' | 'M15_TO_60M' | 'H1_TO_4H' | 'H4_TO_24H' | 'GT_24H' {
  if (milliseconds < 5 * 60_000) return 'LT_5M';
  if (milliseconds < 15 * 60_000) return 'M5_TO_15M';
  if (milliseconds < 60 * 60_000) return 'M15_TO_60M';
  if (milliseconds < 4 * 3600_000) return 'H1_TO_4H';
  if (milliseconds <= 24 * 3600_000) return 'H4_TO_24H';
  return 'GT_24H';
}
function pageInput(cursor: string | undefined, limit: number) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (cursor !== undefined &&
      (!/^[1-9][0-9]{0,18}$/.test(cursor) ||
        BigInt(cursor) > 9223372036854775807n))
  )
    throw new IdentityError('INVALID_INPUT', 'Invalid pagination');
}
function validateText(body: string) {
  if (
    typeof body !== 'string' ||
    !body.trim() ||
    Array.from(body).length > 4000 ||
    body.includes('\u0000') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      body
    )
  )
    throw new IdentityError(
      'INVALID_INPUT',
      'Text must contain 1 to 4000 Unicode characters'
    );
}
export class ConversationStore {
  private readonly limits: MessageLimits;
  constructor(
    private readonly client: postgres.Sql,
    private readonly allowSyntheticVerification = false,
    limits: Partial<MessageLimits> = {}
  ) {
    this.limits = { ...MESSAGE_LIMIT_DEFAULTS, ...limits };
    if (
      Object.values(this.limits).some((n) => !Number.isSafeInteger(n) || n < 1)
    )
      throw new Error('Invalid message limits');
  }

  private async sendEligible(
    tx: Sql,
    userId: string,
    context: ConversationContext
  ): Promise<boolean> {
    if (context.state !== 'OPEN') return false;
    const actors = await tx<
      { id: string }[]
    >`SELECT id FROM users WHERE id=${userId} AND account_state='ACTIVE' FOR SHARE`;
    const phones = await tx<
      { id: string }[]
    >`SELECT id FROM phone_contacts WHERE user_id=${userId} AND verified_at IS NOT NULL AND replaced_at IS NULL FOR SHARE`;
    if (!actors[0] || !phones[0]) return false;
    if (context.provider_user_id === userId) {
      if (
        context.profile_state !== 'ACTIVE' ||
        context.provider_state !== 'ACTIVE'
      )
        return false;
      const claims = await tx<
        { id: string }[]
      >`SELECT vc.source_case_id AS id FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id
        WHERE vc.provider_profile_id=${context.provider_profile_id} AND vc.claim_type='PROVIDER_IDENTITY' AND vc.status='VERIFIED' AND vc.revoked_at IS NULL
        AND vc.valid_from<=statement_timestamp() AND vc.valid_until>statement_timestamp() AND c.state='VERIFIED'
        AND (c.policy_version<>'provider-identity-synthetic-v1' OR ${this.allowSyntheticVerification}) FOR SHARE OF vc,c`;
      if (!claims[0]) return false;
    }
    const blocks = await tx<
      { id: string }[]
    >`SELECT b.id FROM block_relationships b WHERE b.revoked_at IS NULL AND (
      (b.blocker_user_id=${context.seeker_user_id} AND (b.blocked_provider_account_id=${context.provider_account_id} OR b.blocked_user_id=${context.provider_user_id})) OR
      (b.blocker_user_id=${context.provider_user_id} AND b.blocked_user_id=${context.seeker_user_id})) LIMIT 1`;
    return !blocks[0];
  }

  private async project(tx: Sql, rows: MessageRow[]): Promise<SafeMessage[]> {
    if (!rows.length) return [];
    const receipts = await tx<
      {
        message_id: string;
        recipient_user_id: string;
        delivered_at: Date | null;
        read_at: Date | null;
      }[]
    >`SELECT message_id,recipient_user_id,delivered_at,read_at FROM message_receipts WHERE message_id=ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY recipient_user_id`;
    return rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      sender_user_id: row.sender_user_id,
      sender_side: row.sender_side,
      client_message_id: row.client_message_id,
      visibility_state: row.visibility_state,
      sequence: String(row.sequence),
      body: row.visibility_state === 'VISIBLE' ? row.body : null,
      sent_at: new Date(row.sent_at).toISOString(),
      receipts: receipts
        .filter((r) => r.message_id === row.id)
        .map((r) => ({
          recipient_user_id: r.recipient_user_id,
          delivered_at: r.delivered_at
            ? new Date(r.delivered_at).toISOString()
            : null,
          read_at: r.read_at ? new Date(r.read_at).toISOString() : null
        }))
    }));
  }

  async send(
    userId: string,
    conversationId: string,
    input: { client_message_id: string; body: string }
  ): Promise<{ message: SafeMessage; created: boolean }> {
    if (!input || !isUuid(input.client_message_id ?? ''))
      throw new IdentityError('INVALID_INPUT', 'Invalid client message ID');
    validateText(input.body);
    return this.client.begin(async (tx) => {
      // Serialize sender retries and both rate scopes across connections/processes.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`message-sender:${userId}`},0))`;
      // Shared lock prevents a concurrent block insert/revoke racing this authorization.
      // Future block commands can replace this with a finer shared locking protocol.
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const context = await requireConversationAccess(
        tx,
        userId,
        conversationId,
        'conversation',
        true
      );
      const canonicalConversationId = context.conversation_id;
      if (context.state === 'CLOSED')
        throw new IdentityError(
          'CONVERSATION_CLOSED',
          'Conversation is not open'
        );
      if (!(await this.sendEligible(tx, userId, context)))
        throw new IdentityError(
          'CAPABILITY_RESTRICTED',
          'Messaging is not available'
        );
      const previous = await tx<
        MessageRow[]
      >`SELECT *,sequence::text FROM messages WHERE sender_user_id=${userId} AND client_message_id=${input.client_message_id}`;
      if (previous[0]) {
        if (
          previous[0].conversation_id !== canonicalConversationId ||
          previous[0].body !== input.body
        )
          throw new IdentityError(
            'IDEMPOTENCY_KEY_REUSED',
            'Client message ID was used for another request'
          );
        return {
          message: (await this.project(tx, previous))[0]!,
          created: false
        };
      }
      const windows = await tx<
        { window_start: string }[]
      >`SELECT to_timestamp(floor(extract(epoch FROM statement_timestamp())/${this.limits.windowSeconds})*${this.limits.windowSeconds})::text AS window_start`;
      const windowStart = windows[0]!.window_start;
      for (const [scope, limit] of [
        ['GLOBAL', this.limits.global],
        [canonicalConversationId, this.limits.conversation]
      ] as const) {
        const counters = await tx<
          { message_count: number }[]
        >`INSERT INTO message_rate_limits(sender_user_id,scope,window_start,message_count)
          VALUES (${userId},${scope},${windowStart}::timestamptz,1)
          ON CONFLICT (sender_user_id,scope) DO UPDATE SET
            window_start=EXCLUDED.window_start,
            message_count=CASE WHEN message_rate_limits.window_start=EXCLUDED.window_start THEN message_rate_limits.message_count+1 ELSE 1 END
          RETURNING message_count`;
        if (counters[0]!.message_count > limit)
          throw new IdentityError('RATE_LIMITED', 'Too many messages');
      }
      const side: Side =
        userId === context.seeker_user_id ? 'SEEKER' : 'PROVIDER';
      const messages = await tx<
        MessageRow[]
      >`INSERT INTO messages(conversation_id,sender_user_id,sender_side,client_message_id,body) VALUES (${canonicalConversationId},${userId},${side},${input.client_message_id},${input.body}) RETURNING *,sequence::text`;
      const message = messages[0]!;
      const recipient =
        side === 'SEEKER' ? context.provider_user_id : context.seeker_user_id;
      await tx`INSERT INTO message_receipts(message_id,recipient_user_id) VALUES (${message.id},${recipient})`;
      await tx`INSERT INTO communication_outbox(interaction_id,message_id,event_type,safe_payload,occurred_at) VALUES (${context.id},${message.id},'message_sent',${JSON.stringify({ message_id: message.id, interaction_id: context.id, conversation_id: canonicalConversationId, sender_user_id: userId, sender_side: side })}::jsonb,${message.sent_at})`;
      if (side === 'PROVIDER')
        await tx`INSERT INTO communication_outbox(interaction_id,message_id,event_type,schema_version,safe_payload,occurred_at) VALUES (${context.id},${message.id},'provider_first_response',${RESPONSE_BUCKET_VERSION},${JSON.stringify({ interaction_id: context.id, response_time_bucket: responseTimeBucket(+new Date(message.sent_at) - +new Date(context.opened_at)) })}::jsonb,${message.sent_at}) ON CONFLICT (interaction_id) WHERE event_type='provider_first_response' DO NOTHING`;
      return { message: (await this.project(tx, messages))[0]!, created: true };
    });
  }

  async messages(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit = 30
  ) {
    pageInput(cursor, limit);
    return this.client.begin(async (tx) => {
      const context = await requireConversationAccess(
        tx,
        userId,
        conversationId
      );
      const rows = await tx<
        MessageRow[]
      >`SELECT *,sequence::text FROM messages WHERE conversation_id=${conversationId} ${cursor ? tx`AND sequence<${cursor}::bigint` : tx``} ORDER BY messages.sequence DESC LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      return {
        items: await this.project(tx, page),
        next_cursor: rows.length > limit ? String(page.at(-1)!.sequence) : null,
        can_send: await this.sendEligible(tx, userId, context),
        actor_side:
          userId === context.seeker_user_id
            ? ('SEEKER' as const)
            : ('PROVIDER' as const)
      };
    });
  }

  async acknowledge(
    userId: string,
    conversationId: string,
    input: { message_ids: string[]; state: 'DELIVERED' | 'READ' }
  ) {
    if (
      !input ||
      !Array.isArray(input.message_ids) ||
      !input.message_ids.length ||
      input.message_ids.length > 50 ||
      input.message_ids.some((id) => typeof id !== 'string' || !isUuid(id)) ||
      !['DELIVERED', 'READ'].includes(input.state)
    )
      throw new IdentityError('INVALID_INPUT', 'Invalid acknowledgement');
    const ids = [...new Set(input.message_ids.map(id => id.toLowerCase()))];
    return this.client.begin(async (tx) => {
      await requireConversationAccess(tx, userId, conversationId);
      const targets = await tx<
        { message_id: string }[]
      >`SELECT r.message_id FROM message_receipts r JOIN messages m ON m.id=r.message_id WHERE m.conversation_id=${conversationId} AND m.id=ANY(${ids}::uuid[]) AND m.sender_user_id<>${userId} AND r.recipient_user_id=${userId} FOR UPDATE OF r`;
      if (targets.length !== ids.length)
        throw new IdentityError(
          'RESOURCE_SCOPE_DENIED',
          'Receipt is unavailable'
        );
      const rows = await tx<
        {
          message_id: string;
          recipient_user_id: string;
          delivered_at: Date;
          read_at: Date | null;
        }[]
      >`UPDATE message_receipts SET delivered_at=COALESCE(delivered_at,statement_timestamp()),read_at=CASE WHEN ${input.state}='READ' THEN COALESCE(read_at,statement_timestamp()) ELSE read_at END WHERE recipient_user_id=${userId} AND message_id=ANY(${ids}::uuid[]) RETURNING message_id,recipient_user_id,delivered_at,read_at`;
      return {
        receipts: rows.map((r) => ({
          ...r,
          delivered_at: new Date(r.delivered_at).toISOString(),
          read_at: r.read_at ? new Date(r.read_at).toISOString() : null
        }))
      };
    });
  }

  async inbox(userId: string, cursor?: string, limit = 20) {
    if (!isUuid(userId) || !Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new IdentityError('INVALID_INPUT', 'Invalid inbox request');
    let after: { opened_at: string; id: string } | null = null;
    if (cursor) {
      try {
        after = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
          opened_at: string;
          id: string;
        };
      } catch {
        throw new IdentityError('INVALID_INPUT', 'Invalid inbox cursor');
      }
      if (
        !after ||
        !isUuid(after.id) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
          after.opened_at
        ) ||
        !Number.isFinite(Date.parse(after.opened_at))
      )
        throw new IdentityError('INVALID_INPUT', 'Invalid inbox cursor');
    }
    return this.client.begin(async (tx) => {
      const rows = await tx<
        (ConversationContext & {
          cursor_time: string;
          latest_message_at: Date | null;
        })[]
      >`SELECT i.id,c.id AS conversation_id,i.listing_id,i.state,i.opened_at,to_char(i.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,(SELECT max(m.sent_at) FROM messages m WHERE m.conversation_id=c.id) AS latest_message_at
        FROM interactions i JOIN conversations c ON c.interaction_id=i.id JOIN provider_accounts pa ON pa.id=i.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
        WHERE ${conversationActorPredicate(tx, userId)} ${after ? tx`AND (i.opened_at,i.id)<(${after.opened_at}::timestamptz,${after.id}::uuid)` : tx``} ORDER BY i.opened_at DESC,i.id DESC LIMIT ${limit + 1} FOR SHARE OF i,c,pa,pp`;
      const page = rows.slice(0, limit);
      const items = [];
      for (const row of page)
        items.push({
          conversation_id: row.conversation_id,
          interaction_id: row.id,
          listing_id: row.listing_id,
          state: row.state,
          opened_at: new Date(row.opened_at).toISOString(),
          latest_message_at: row.latest_message_at
            ? new Date(row.latest_message_at).toISOString()
            : null,
          ...(await conversationListingProjection(
            tx,
            row.listing_id,
            this.allowSyntheticVerification
          ))
        });
      const last = page.at(-1);
      return {
        items,
        next_cursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({ opened_at: last.cursor_time, id: last.id })
              ).toString('base64url')
            : null
      };
    });
  }
}
