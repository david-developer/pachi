import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { conversationSendEligible } from './conversation.js';
import { isUuid, requireConversationAccess } from './conversation-access.js';
import { contactProhibited } from './contact-safety.js';
import { readPublicListingVisibility } from './listing-visibility.js';

type Tx = postgres.TransactionSql;
export type BlockActor = { userId: string; sessionId: string; securityVersion: number };
export type BlockCommand = { idempotencyKey: string; requestId: string };
export type SafeBlock = { id: string; subject_kind: 'USER' | 'PROVIDER_ACCOUNT'; state: 'ACTIVE' | 'REVOKED'; created_at: string; revoked_at: string | null; version: number };
export type ContactSafety = { can_contact: boolean; can_block: boolean; own_block: SafeBlock | null };
type Row = { id: string; blocked_user_id: string | null; blocked_provider_account_id: string | null; created_at: Date; revoked_at: Date | null; version: number };
type Context = { seeker_user_id: string; provider_account_id: string; provider_user_id: string | null; kind: string; state: string };
type Target = { userId: string | null; providerId: string | null; context: Context };
const fail = (code = 'RESOURCE_SCOPE_DENIED') => new IdentityError(code, code);
const project = (r: Row): SafeBlock => ({ id: r.id, subject_kind: r.blocked_user_id ? 'USER' : 'PROVIDER_ACCOUNT', state: r.revoked_at ? 'REVOKED' : 'ACTIVE', created_at: new Date(r.created_at).toISOString(), revoked_at: r.revoked_at ? new Date(r.revoked_at).toISOString() : null, version: r.version });

export class BlockStore {
  constructor(private readonly client: postgres.Sql, private readonly allowSyntheticVerification = false) {}

  private async actor(tx: Tx, actor: BlockActor) {
    if (!isUuid(actor.userId) || !isUuid(actor.sessionId) || !Number.isSafeInteger(actor.securityVersion)) throw fail('AUTH_REQUIRED');
    const rows = await tx<{ account_state: string }[]>`SELECT u.account_state FROM security_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.revoked_at IS NULL
      AND s.expires_at>statement_timestamp() AND u.security_version=${actor.securityVersion} FOR SHARE OF s,u`;
    if (!rows[0] || ['SUSPENDED','DELETED'].includes(rows[0].account_state)) throw fail('AUTH_REQUIRED');
    // Own protective controls do not confer participation. All remaining states
    // accepted by registered authentication may manage their own safety episodes.
    if (!['ACTIVE','PENDING_PHONE','LIMITED','DEACTIVATED','DELETION_PENDING'].includes(rows[0].account_state)) throw fail('CAPABILITY_RESTRICTED');
  }

  private async target(tx: Tx, userId: string, source: 'interaction' | 'listing', id: string): Promise<Target> {
    if (!isUuid(id)) throw fail();
    let context: Context | undefined;
    if (source === 'interaction') {
      // Seeker authority survives hidden listings. Membership and historical
      // participant rows never establish organization-side command authority.
      const rows = await tx<Context[]>`SELECT i.seeker_user_id,i.provider_account_id,pp.user_id AS provider_user_id,pa.kind,i.state
        FROM interactions i JOIN provider_accounts pa ON pa.id=i.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
        WHERE i.id=${id} AND (i.seeker_user_id=${userId} OR (pa.kind='INDIVIDUAL' AND pp.user_id=${userId})) FOR SHARE OF i,pa`;
      context = rows[0];
      if (context?.provider_user_id) {
        const profiles=await tx<{user_id:string}[]>`SELECT user_id FROM provider_profiles WHERE id=(SELECT provider_profile_id FROM provider_accounts WHERE id=${context.provider_account_id}) FOR SHARE`;
        context.provider_user_id=profiles[0]?.user_id??null;
      }
    } else {
      const rows = await tx<Context[]>`SELECT ${userId}::uuid AS seeker_user_id,l.provider_account_id,pp.user_id AS provider_user_id,pa.kind,'OPEN' AS state
        FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${id} FOR SHARE OF l,pa`;
      context = rows[0];
      if (context?.provider_user_id) {
        const profiles=await tx<{user_id:string}[]>`SELECT user_id FROM provider_profiles WHERE id=(SELECT provider_profile_id FROM provider_accounts WHERE id=${context.provider_account_id}) FOR SHARE`;
        context.provider_user_id=profiles[0]?.user_id??null;
      }
      if (!context || !(await readPublicListingVisibility(tx,id,{allowSyntheticVerification:this.allowSyntheticVerification})).visible) throw fail();
    }
    if (!context || context.seeker_user_id === context.provider_user_id) throw fail();
    if (context.seeker_user_id === userId) {
      if (context.provider_user_id === userId) throw fail();
      return { userId: null, providerId: context.provider_account_id, context };
    }
    if (context.kind !== 'INDIVIDUAL' || context.provider_user_id !== userId) throw fail();
    return { userId: context.seeker_user_id, providerId: null, context };
  }

  private async own(tx: Tx, actorId: string, target: Target): Promise<Row | undefined> {
    const rows = await tx<Row[]>`SELECT * FROM block_relationships WHERE blocker_user_id=${actorId} AND revoked_at IS NULL
      AND (blocked_user_id=${target.userId} OR blocked_provider_account_id=${target.providerId})`;
    return rows[0];
  }

  async safety(actor: BlockActor, source: 'interaction' | 'listing', id: string): Promise<ContactSafety> {
    return this.client.begin(async tx => {
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      await this.actor(tx,actor);
      const userId=actor.userId.toLowerCase();
      const target=await this.target(tx,userId,source,id);
      const own=await this.own(tx,userId,target);
      const users=await tx<{id:string}[]>`SELECT id FROM users WHERE id=${userId} AND account_state='ACTIVE' AND EXISTS
        (SELECT 1 FROM phone_contacts WHERE user_id=${userId} AND verified_at IS NOT NULL AND replaced_at IS NULL) FOR SHARE`;
      // This projection only authorizes listing inquiry affordances; message
      // capability remains ConversationStore's full eligibility decision.
      let eligible=!!users[0] && target.context.state==='OPEN' && target.context.kind==='INDIVIDUAL';
      if (source==='interaction' && eligible) eligible=await conversationSendEligible(tx,userId,await requireConversationAccess(tx,userId,id,'interaction'),this.allowSyntheticVerification);
      if (source==='listing' && eligible) {
        const restricted=await tx`SELECT id FROM interactions WHERE listing_id=${id} AND seeker_user_id=${userId} AND provider_account_id=${target.context.provider_account_id} AND state='RESTRICTED'`;
        eligible=!restricted[0];
      }
      return {can_contact:eligible && !(await contactProhibited(tx,target.context.seeker_user_id,target.context.provider_account_id,target.context.provider_user_id)),can_block:!own,own_block:own?project(own):null};
    });
  }

  async list(actor: BlockActor, cursor?: string, limit=20): Promise<{items:SafeBlock[];next_cursor:string|null}> {
    if (!Number.isInteger(limit) || limit<1 || limit>50 || (cursor!==undefined && !isUuid(cursor))) throw fail('INVALID_INPUT');
    return this.client.begin(async tx => {
      await this.actor(tx,actor);
      const rows=await tx<Row[]>`SELECT * FROM block_relationships WHERE blocker_user_id=${actor.userId} ${cursor?tx`AND id<${cursor}::uuid`:tx``} ORDER BY id DESC LIMIT ${limit+1}`;
      return {items:rows.slice(0,limit).map(project),next_cursor:rows.length>limit?rows[limit-1]!.id:null};
    });
  }

  async block(actor: BlockActor, source: 'interaction' | 'listing', sourceId: string, input: BlockCommand): Promise<SafeBlock> {
    return this.command(actor,source==='interaction'?'BLOCK_INTERACTION':'BLOCK_LISTING',{source_id:sourceId.toLowerCase()},input,async (tx,userId,previous) => {
      // Recheck source authority even for a committed retry, without recreating
      // its historical episode. Disappeared sources still have own-list/unblock.
      const target=await this.target(tx,userId,source,sourceId);
      if (previous) return this.episode(tx,userId,previous);
      const active=await this.own(tx,userId,target);
      if (active) return active;
      const rows=await tx<Row[]>`INSERT INTO block_relationships(blocker_user_id,blocked_user_id,blocked_provider_account_id) VALUES (${userId},${target.userId},${target.providerId}) RETURNING *`;
      await this.event(tx,userId,rows[0]!, 'BLOCK',input.requestId);
      return rows[0]!;
    });
  }

  async unblock(actor: BlockActor, id: string, input: BlockCommand & {expectedVersion:number}): Promise<SafeBlock> {
    if (!isUuid(id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1) throw fail('INVALID_INPUT');
    return this.command(actor,'UNBLOCK',{block_id:id.toLowerCase(),expected_version:input.expectedVersion},input,async(tx,userId,previous) => {
      const row=await this.episode(tx,userId,previous??id);
      if (previous) return row;
      if (row.version!==input.expectedVersion || row.revoked_at) throw fail('STALE_VERSION');
      const rows=await tx<Row[]>`UPDATE block_relationships SET revoked_at=statement_timestamp(),version=version+1 WHERE id=${row.id} RETURNING *`;
      await this.event(tx,userId,rows[0]!, 'UNBLOCK',input.requestId);
      return rows[0]!;
    });
  }

  private async episode(tx:Tx,userId:string,id:string):Promise<Row> {
    const rows=await tx<Row[]>`SELECT * FROM block_relationships WHERE id=${id} AND blocker_user_id=${userId} FOR UPDATE`;
    if (!rows[0]) throw fail(); return rows[0];
  }

  private async command(actor:BlockActor,operation:string,payload:unknown,input:BlockCommand,work:(tx:Tx,userId:string,previous:string|null)=>Promise<Row>):Promise<SafeBlock> {
    if (!isUuid(input.idempotencyKey??'') || !isUuid(input.requestId??'')) throw fail('INVALID_INPUT');
    const requestHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return this.client.begin(async tx => {
      // READ COMMITTED: reads after this gate observe every earlier committed block.
      await tx`LOCK TABLE block_relationships IN SHARE ROW EXCLUSIVE MODE`;
      await this.actor(tx,actor);
      const userId=actor.userId.toLowerCase();
      const receipts=await tx<{block_id:string;request_hash:string}[]>`SELECT block_id,request_hash FROM block_command_receipts WHERE actor_user_id=${userId} AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`;
      if (receipts[0] && receipts[0].request_hash!==requestHash) throw fail('IDEMPOTENCY_KEY_REUSED');
      const row=await work(tx,userId,receipts[0]?.block_id??null);
      if (!receipts[0]) await tx`INSERT INTO block_command_receipts(actor_user_id,operation,idempotency_key,request_hash,block_id) VALUES (${userId},${operation},${input.idempotencyKey},${requestHash},${row.id})`;
      return project(row);
    });
  }

  private async event(tx:Tx,userId:string,row:Row,operation:'BLOCK'|'UNBLOCK',requestId:string) {
    const actions=await tx<{id:string}[]>`INSERT INTO block_actions(block_id,actor_user_id,operation,request_id,prior_state,new_state,version)
      VALUES (${row.id},${userId},${operation},${requestId},${operation==='BLOCK'?'ABSENT':'ACTIVE'},${operation==='BLOCK'?'ACTIVE':'REVOKED'},${row.version}) RETURNING id`;
    await tx`INSERT INTO block_outbox(action_id,block_id,event_type,version) VALUES (${actions[0]!.id},${row.id},${operation},${row.version})`;
    await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
      VALUES (${userId},${operation},'BlockRelationship',${row.id},'OWN_SAFETY_COMMAND',${requestId},${JSON.stringify({policy_version:'block-contact-v1',version:row.version,subject_kind:row.blocked_user_id?'USER':'PROVIDER_ACCOUNT',before_state:operation==='BLOCK'?'ABSENT':'ACTIVE',after_state:operation==='BLOCK'?'ACTIVE':'REVOKED'})}::jsonb)`;
  }
}
