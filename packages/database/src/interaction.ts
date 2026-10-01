import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { readPublicListingVisibility } from './listing-visibility.js';

type Sql = postgres.Sql | postgres.TransactionSql;
type InteractionRow = { id: string; listing_id: string; provider_account_id: string; seeker_user_id: string; state: 'OPEN' | 'CLOSED' | 'RESTRICTED'; opened_at: Date; conversation_id: string };
export type InteractionResult = { interaction_id: string; conversation_id: string; listing_id: string; state: 'OPEN' | 'CLOSED' | 'RESTRICTED'; opened_at: string; created: boolean };
export type InteractionRead = InteractionResult & { title: string | null; listing_visible: boolean };
const uuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export class InteractionStore {
  public constructor(private readonly client: postgres.Sql, private readonly allowSyntheticVerification = false) {}

  public async createOrReuseInquiry(userId: string, listingId: string, idempotencyKey: string, requestId: string | null): Promise<InteractionResult> {
    if (!uuid(userId) || !uuid(listingId) || !uuid(idempotencyKey)) throw new IdentityError('INVALID_INPUT', 'Inquiry request is invalid');
    const requestHash = createHash('sha256').update(JSON.stringify({listing_id:listingId,initial_channel:'MESSAGE'})).digest('hex');
    return this.client.begin(async (tx) => {
      const userRows = await tx<{id:string}[]>`SELECT u.id FROM users u WHERE u.id=${userId} AND u.account_state='ACTIVE' AND EXISTS (SELECT 1 FROM phone_contacts pc WHERE pc.user_id=u.id AND pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL) FOR SHARE OF u`;
      if (!userRows[0]) throw new IdentityError('PHONE_REQUIRED', 'A current verified phone is required for contact');
      const previous = await tx<InteractionRow[]>`SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,i.opened_at,c.id AS conversation_id FROM interaction_idempotency k JOIN interactions i ON i.id=k.interaction_id JOIN conversations c ON c.id=k.conversation_id WHERE k.seeker_user_id=${userId} AND k.operation='CREATE_INQUIRY' AND k.idempotency_key=${idempotencyKey} FOR UPDATE`;
      if (previous[0]) {
        const hashes = await tx<{request_hash:string}[]>`SELECT request_hash FROM interaction_idempotency WHERE seeker_user_id=${userId} AND operation='CREATE_INQUIRY' AND idempotency_key=${idempotencyKey}`;
        if (hashes[0]?.request_hash !== requestHash) throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'Inquiry key was used for another request');
        return map(previous[0], false);
      }
      const context = await tx<{listing_id:string;provider_account_id:string;provider_user_id:string}[]>`SELECT l.id AS listing_id,l.provider_account_id,pp.user_id AS provider_user_id FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${listingId} FOR SHARE OF l,pa,pp`;
      const listing = context[0];
      if (!listing) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing is not available');
      if (listing.provider_user_id === userId) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Self contact is not available');
      const visibility = await readPublicListingVisibility(tx, listingId, {allowSyntheticVerification:this.allowSyntheticVerification});
      if (!visibility.visible) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing is not available');
      const existing = await tx<InteractionRow[]>`SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,i.opened_at,c.id AS conversation_id FROM interactions i JOIN conversations c ON c.interaction_id=i.id WHERE i.listing_id=${listingId} AND i.seeker_user_id=${userId} AND i.provider_account_id=${listing.provider_account_id} AND i.state='OPEN' FOR UPDATE`;
      if (existing[0]) {
        const keyRows = await tx<{id:string}[]>`INSERT INTO interaction_idempotency(seeker_user_id,operation,idempotency_key,request_hash,interaction_id,conversation_id) VALUES (${userId},'CREATE_INQUIRY',${idempotencyKey},${requestHash},${existing[0]!.id},${existing[0]!.conversation_id}) ON CONFLICT (seeker_user_id,operation,idempotency_key) DO NOTHING RETURNING id`;
        if (!keyRows[0]) {
          const priorKey = await tx<{request_hash:string}[]>`SELECT request_hash FROM interaction_idempotency WHERE seeker_user_id=${userId} AND operation='CREATE_INQUIRY' AND idempotency_key=${idempotencyKey}`;
          if (priorKey[0]?.request_hash !== requestHash) throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'Inquiry key was used for another request');
        }
        return map(existing[0], false);
      }
      const inserted = await tx<InteractionRow[]>`INSERT INTO interactions(listing_id,seeker_user_id,provider_account_id,state,initial_channel) VALUES (${listingId},${userId},${listing.provider_account_id},'OPEN','MESSAGE') ON CONFLICT (listing_id,seeker_user_id,provider_account_id) WHERE state='OPEN' DO NOTHING RETURNING id,listing_id,provider_account_id,seeker_user_id,state,opened_at,NULL::uuid AS conversation_id`;
      let interaction = inserted[0];
      let created = true;
      if (!interaction) {
        const concurrent = await tx<InteractionRow[]>`SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,i.opened_at,c.id AS conversation_id FROM interactions i JOIN conversations c ON c.interaction_id=i.id WHERE i.listing_id=${listingId} AND i.seeker_user_id=${userId} AND i.provider_account_id=${listing.provider_account_id} AND i.state='OPEN' FOR UPDATE`;
        interaction = concurrent[0]; created = false;
      }
      if (!interaction) throw new IdentityError('INTERACTION_CREATE_FAILED', 'Inquiry could not be created');
      if (created) {
        const conversations = await tx<{id:string}[]>`INSERT INTO conversations(interaction_id) VALUES (${interaction.id}) RETURNING id`;
        const conversation = conversations[0];
        if (!conversation) throw new IdentityError('CONVERSATION_CREATE_FAILED', 'Conversation could not be created');
        interaction = {...interaction, conversation_id:conversation.id};
        await tx`INSERT INTO interaction_participants(interaction_id,user_id,side) VALUES (${interaction.id},${userId},'SEEKER'),(${interaction.id},${listing.provider_user_id},'PROVIDER') ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO interaction_outbox(interaction_id,event_type,safe_payload) VALUES (${interaction.id},'interaction_created',${JSON.stringify({interaction_id:interaction.id,listing_id:listingId,seeker_user_id:userId,provider_account_id:listing.provider_account_id,channel:'MESSAGE'})}::jsonb)`;
      } else if (!interaction.conversation_id) throw new IdentityError('CONVERSATION_READ_FAILED', 'Conversation could not be read');
      const keyRows = await tx<{id:string}[]>`INSERT INTO interaction_idempotency(seeker_user_id,operation,idempotency_key,request_hash,interaction_id,conversation_id) VALUES (${userId},'CREATE_INQUIRY',${idempotencyKey},${requestHash},${interaction.id},${interaction.conversation_id}) ON CONFLICT (seeker_user_id,operation,idempotency_key) DO NOTHING RETURNING id`;
      if (!keyRows[0]) {
        const priorKey = await tx<{request_hash:string}[]>`SELECT request_hash FROM interaction_idempotency WHERE seeker_user_id=${userId} AND operation='CREATE_INQUIRY' AND idempotency_key=${idempotencyKey}`;
        if (priorKey[0]?.request_hash !== requestHash) throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'Inquiry key was used for another request');
      }
      return map(interaction, created);
    });
  }

  public async read(userId: string, interactionId: string): Promise<InteractionRead> {
    if (!uuid(userId) || !uuid(interactionId)) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Interaction is unavailable');
    const rows = await this.client<(InteractionRow & {provider_user_id:string;title:string|null})[]>`SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,i.opened_at,c.id AS conversation_id,pp.user_id AS provider_user_id,CASE WHEN l.publication_status='PUBLISHED' AND l.moderation_status='APPROVED' THEN r.title ELSE NULL END AS title FROM interactions i JOIN conversations c ON c.interaction_id=i.id JOIN listings l ON l.id=i.listing_id JOIN listing_revisions r ON r.id=l.current_revision_id JOIN provider_accounts pa ON pa.id=i.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE i.id=${interactionId} AND (i.seeker_user_id=${userId} OR pp.user_id=${userId})`;
    const row = rows[0];
    if (!row) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Interaction is unavailable');
    return {...map(row,false),title:row.title,listing_visible:row.title !== null};
  }
}

function map(row: InteractionRow, created: boolean): InteractionResult {
  return {interaction_id:row.id,conversation_id:row.conversation_id,listing_id:row.listing_id,state:row.state,opened_at:new Date(row.opened_at).toISOString(),created};
}
