import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { readPublicListingVisibility } from './listing-visibility.js';

type Sql = postgres.Sql | postgres.TransactionSql;
export type ConversationContext = {
  id: string;
  conversation_id: string;
  listing_id: string;
  provider_account_id: string;
  provider_profile_id: string;
  provider_user_id: string;
  seeker_user_id: string;
  state: 'OPEN' | 'CLOSED' | 'RESTRICTED';
  opened_at: Date;
  provider_state: string;
  profile_state: string;
};
export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

// Current principals only. Historical participants are attribution, never authority.
export function conversationActorPredicate(sql: Sql, userId: string) {
  return sql`pa.kind='INDIVIDUAL' AND (i.seeker_user_id=${userId} OR pp.user_id=${userId})`;
}
export async function requireConversationAccess(
  sql: Sql,
  userId: string,
  id: string,
  boundary: 'conversation' | 'interaction' = 'conversation',
  writing = false
): Promise<ConversationContext> {
  if (!isUuid(userId) || !isUuid(id))
    throw new IdentityError(
      'RESOURCE_SCOPE_DENIED',
      'Conversation is unavailable'
    );
  const rows = await sql<
    ConversationContext[]
  >`SELECT i.id,c.id AS conversation_id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,i.opened_at,pa.provider_profile_id,pp.user_id AS provider_user_id,pa.state AS provider_state,pp.state AS profile_state
    FROM interactions i JOIN conversations c ON c.interaction_id=i.id JOIN provider_accounts pa ON pa.id=i.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
    WHERE ${boundary === 'conversation' ? sql`c.id=${id}` : sql`i.id=${id}`} AND ${conversationActorPredicate(sql, userId)}
    ${writing ? sql`FOR UPDATE OF i FOR SHARE OF c,pa,pp` : sql`FOR SHARE OF i,c,pa,pp`}`;
  if (!rows[0])
    throw new IdentityError(
      'RESOURCE_SCOPE_DENIED',
      'Conversation is unavailable'
    );
  return rows[0];
}
export async function conversationListingProjection(
  sql: Sql,
  listingId: string,
  allowSyntheticVerification: boolean
): Promise<{ title: string | null; listing_visible: boolean }> {
  const visibility = await readPublicListingVisibility(sql, listingId, {
    allowSyntheticVerification
  });
  const titles = visibility.visible
    ? await sql<
        { title: string }[]
      >`SELECT r.title FROM listings l JOIN listing_revisions r ON r.id=l.approved_revision_id WHERE l.id=${listingId} AND l.publication_status='PUBLISHED' AND l.moderation_status='APPROVED' AND l.approved_revision_id=l.current_revision_id`
    : [];
  const title = titles[0]?.title ?? null;
  return { title, listing_visible: visibility.visible && title !== null };
}
