import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';

export const ORDINARY_ORGANIZATION_ROLES = ['LISTING_MANAGER','AGENT','ANALYST'] as const;
export type OrdinaryOrganizationRole = typeof ORDINARY_ORGANIZATION_ROLES[number];
export type OrganizationRole = 'OWNER'|'ADMIN'|OrdinaryOrganizationRole;
export type SupportedOrganizationType = 'REAL_ESTATE_AGENCY'|'PROPERTY_MANAGEMENT_COMPANY'|'CORPORATE_PROPERTY_OWNER';
export type OrganizationActor = {userId:string;sessionId:string;securityVersion:number};
type Command = {idempotencyKey:string;requestId:string};
type VersionCommand = Command & {expectedVersion:number};
type Page = {cursor?:string|undefined;limit?:number|undefined};
type Tx = postgres.TransactionSql;
type OrganizationState = 'DRAFT'|'ACTIVE'|'RESTRICTED'|'SUSPENDED'|'CLOSED';
type MemberState = 'INVITED'|'ACTIVE'|'SUSPENDED'|'REVOKED'|'DECLINED'|'EXPIRED';
type InvitationState = Exclude<MemberState,'SUSPENDED'>;
export type OrganizationSummary = {
  id:string;public_name:string;organization_type:SupportedOrganizationType;state:OrganizationState;version:number;provider_account_id:string;
  business_verification:'NOT_VERIFIED';publication_eligible:false;public_contact:{phone:string|null};created_at:string;
  membership:{id:string;role:OrganizationRole;state:MemberState;version:number};
};
export type OrganizationMember = {id:string;organization_id:string;user_id:string;role:OrganizationRole;state:MemberState;version:number;activated_at:string|null;revoked_at:string|null};
export type OrganizationInvitation = {
  id:string;organization_id:string;organization_public_name:string;membership_id:string;role:OrdinaryOrganizationRole;
  state:InvitationState;version:number;expires_at:string;created_at:string;can_respond:boolean;
};
export type OrganizationInvitationDelivery = {
  deliver(input:{recipientUserId:string;invitationId:string;token:string;expiresAt:string}):Promise<void>;
  forget(recipientUserId:string,invitationId:string):void;
};
/** Private transient test adapter, never an HTTP/token API. */
export class LocalOrganizationInvitationSink implements OrganizationInvitationDelivery {
  private readonly tokens=new Map<string,{token:string;expiresAt:string}>();
  public async deliver(input:{recipientUserId:string;invitationId:string;token:string;expiresAt:string}):Promise<void>{
    this.tokens.set(`${input.recipientUserId}:${input.invitationId}`,{token:input.token,expiresAt:input.expiresAt});
  }
  public read(userId:string,invitationId:string):{token:string;expiresAt:string}|null {
    const value=this.tokens.get(`${userId}:${invitationId}`);
    return !value||new Date(value.expiresAt)<=new Date()?null:{...value};
  }
  public forget(userId:string,invitationId:string):void{this.tokens.delete(`${userId}:${invitationId}`);}
}
type Contact={id:string;user_id:string;normalized_e164:string;verification_version:number};
type MemberRow=Omit<OrganizationMember,'activated_at'|'revoked_at'>&{activated_at:Date|string|null;revoked_at:Date|string|null};
type InvitationRow=Omit<OrganizationInvitation,'created_at'|'expires_at'|'can_respond'>&{
  recipient_user_id:string;recipient_contact_id:string;recipient_contact_version:number;token_digest:string;
  invited_by:string;
  created_at:Date|string;expires_at:Date|string;expired:boolean;
};
const policyVersion='organization-governance-v1';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v)??'null').digest('hex');
const denied=(code='RESOURCE_SCOPE_DENIED'):IdentityError=>new IdentityError(code,code==='RESOURCE_SCOPE_DENIED'?'Organization resource is unavailable':code);
const ordinary=(v:unknown):v is OrdinaryOrganizationRole=>typeof v==='string'&&ORDINARY_ORGANIZATION_ROLES.includes(v as OrdinaryOrganizationRole);
function page(input:Page){const limit=input.limit??20;if(!Number.isInteger(limit)||limit<1||limit>50||(input.cursor!==undefined&&!uuid(input.cursor)))throw denied('INVALID_INPUT');return{limit,cursor:input.cursor??null};}
const timestamp=(value:Date|string):string=>new Date(value).toISOString();
function member(r:MemberRow):OrganizationMember{return{id:r.id,organization_id:r.organization_id,user_id:r.user_id,role:r.role,state:r.state,version:r.version,activated_at:r.activated_at===null?null:timestamp(r.activated_at),revoked_at:r.revoked_at===null?null:timestamp(r.revoked_at)};}
function invitation(r:InvitationRow,actorId:string):OrganizationInvitation{return{
  id:r.id,organization_id:r.organization_id,organization_public_name:r.organization_public_name,membership_id:r.membership_id,
  role:r.role,state:r.state==='INVITED'&&r.expired?'EXPIRED':r.state,version:r.version,expires_at:timestamp(r.expires_at),created_at:timestamp(r.created_at),
  can_respond:r.recipient_user_id===actorId&&r.state==='INVITED'&&!r.expired,
};}

export class OrganizationStore {
  constructor(private readonly client:postgres.Sql,private readonly delivery?:OrganizationInvitationDelivery){}
  private async actor(tx:Tx,actor:OrganizationActor):Promise<Contact>{
    if(!uuid(actor.userId)||!uuid(actor.sessionId)||!Number.isInteger(actor.securityVersion))throw denied('AUTH_REQUIRED');
    const sessions=await tx<{id:string}[]>`SELECT s.id FROM security_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId}
      AND s.revoked_at IS NULL AND s.expires_at>transaction_timestamp() AND u.security_version=${actor.securityVersion} FOR SHARE OF s,u`;
    if(!sessions[0])throw denied('AUTH_REQUIRED');
    const users=await tx<{id:string}[]>`SELECT id FROM users WHERE id=${actor.userId} AND account_state='ACTIVE' FOR SHARE`;
    const contacts=await tx<Contact[]>`SELECT id,user_id,normalized_e164,verification_version FROM phone_contacts WHERE user_id=${actor.userId}
      AND verified_at IS NOT NULL AND replaced_at IS NULL AND verification_version>0 FOR SHARE`;
    if(!users[0]||!contacts[0])throw denied('CAPABILITY_RESTRICTED');return contacts[0];
  }
  private async transaction<T>(actor:OrganizationActor,work:(tx:Tx,contact:Contact)=>Promise<T>):Promise<T>{
    return this.client.begin(async tx=>{await tx`SET LOCAL TIME ZONE 'UTC'`;return work(tx,await this.actor(tx,actor));}) as Promise<T>;
  }
  private async command<T>(actor:OrganizationActor,operation:string,input:Command,payload:unknown,work:(tx:Tx,contact:Contact,receipt:{id:string}|null)=>Promise<T|IdentityError>):Promise<T>{
    if(!uuid(input.idempotencyKey)||!uuid(input.requestId))throw denied('INVALID_INPUT');
    const result=await this.transaction(actor,async(tx,contact)=>{
      // PostgreSQL UUID identities are case-insensitive; the string lock identity
      // must agree with receipt uniqueness for concurrent casing variants.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`org-command:${actor.userId.toLowerCase()}:${operation}:${input.idempotencyKey.toLowerCase()}`},0))`;
      const rows=await tx<{request_hash:string;result:{id:string}}[]>`SELECT request_hash,result FROM organization_command_receipts WHERE actor_user_id=${actor.userId} AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`;
      if(rows[0]&&rows[0].request_hash!==hash(payload))throw denied('IDEMPOTENCY_KEY_REUSED');
      const denials=await tx<{request_hash:string}[]>`SELECT request_hash FROM organization_security_denials WHERE actor_user_id=${actor.userId} AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`;
      if(denials[0]&&denials[0].request_hash!==hash(payload))throw denied('IDEMPOTENCY_KEY_REUSED');
      return work(tx,contact,rows[0]?.result??null);
    });
    // Commit an audited denial/expiry before returning its safe domain error.
    if(result instanceof IdentityError)throw result;return result;
  }
  private async receipt(tx:Tx,actor:OrganizationActor,orgId:string,operation:string,input:Command,payload:unknown,id:string):Promise<void>{
    await tx`INSERT INTO organization_command_receipts(actor_user_id,operation,idempotency_key,request_hash,organization_id,result)
      VALUES (${actor.userId},${operation},${input.idempotencyKey},${hash(payload)},${orgId},${JSON.stringify({id})}::jsonb)`;
  }
  private async privileged(tx:Tx,actor:OrganizationActor,orgId:string,operation:string,input:Command,payload:unknown):Promise<IdentityError>{
    const rows=await tx<{id:string}[]>`INSERT INTO organization_security_denials(actor_user_id,organization_id,operation,idempotency_key,request_hash,request_id,reason_code)
      VALUES (${actor.userId},${orgId},${operation},${input.idempotencyKey},${hash(payload)},${input.requestId},'PRIVILEGED_GOVERNANCE_UNAVAILABLE')
      ON CONFLICT(actor_user_id,operation,idempotency_key) DO NOTHING RETURNING id`;
    if(rows[0])await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
      VALUES (${actor.userId},'ORGANIZATION_PRIVILEGED_OPERATION_DENIED','Organization',${orgId},'PRIVILEGED_GOVERNANCE_UNAVAILABLE',${input.requestId},${JSON.stringify({operation,policy_version:policyVersion})}::jsonb)`;
    return denied('PRIVILEGED_GOVERNANCE_UNAVAILABLE');
  }
  private async organization(tx:Tx,actorId:string,orgId:string,manage=false):Promise<{version:number}>{
    if(!uuid(orgId))throw denied();
    const org=await tx<{version:number}[]>`SELECT version FROM organizations WHERE id=${orgId} AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL FOR UPDATE`;
    const memberships=await tx<{role:OrganizationRole}[]>`SELECT role FROM organization_memberships WHERE organization_id=${orgId} AND user_id=${actorId} AND state='ACTIVE' FOR SHARE`;
    if(!org[0]||!memberships[0]||(manage&&!['OWNER','ADMIN'].includes(memberships[0].role)))throw denied();return org[0];
  }
  private async summary(tx:Tx,actorId:string,orgId:string):Promise<OrganizationSummary>{
    const rows=await tx<{id:string;public_name:string;organization_type:SupportedOrganizationType;state:OrganizationState;version:number;provider_account_id:string;
      public_phone:string|null;created_at:Date|string;member_id:string;member_role:OrganizationRole;member_state:MemberState;member_version:number}[]>`
      SELECT o.id,o.public_name,o.organization_type,o.state,o.version,a.id AS provider_account_id,
        CASE WHEN pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL THEN o.public_phone ELSE NULL END AS public_phone,o.created_at,
        m.id AS member_id,m.role AS member_role,m.state AS member_state,m.version AS member_version FROM organizations o
      JOIN provider_accounts a ON a.organization_id=o.id AND a.kind='ORGANIZATION'
      JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=${actorId} AND m.state='ACTIVE'
      LEFT JOIN phone_contacts pc ON pc.id=o.onboarding_contact_id AND pc.user_id=o.created_by_user_id
      WHERE o.id=${orgId} AND o.state='ACTIVE' AND o.onboarding_completed_at IS NOT NULL`;
    const r=rows[0];if(!r)throw denied();
    return{id:r.id,public_name:r.public_name,organization_type:r.organization_type,state:r.state,version:r.version,provider_account_id:r.provider_account_id,
      business_verification:'NOT_VERIFIED',publication_eligible:false,public_contact:{phone:r.public_phone},created_at:timestamp(r.created_at),
      membership:{id:r.member_id,role:r.member_role,state:r.member_state,version:r.member_version}};
  }
  private async bump(tx:Tx,orgId:string):Promise<number>{
    const rows=await tx<{version:number}[]>`UPDATE organizations SET version=version+1,updated_at=transaction_timestamp() WHERE id=${orgId} RETURNING version`;
    return rows[0]!.version;
  }
  private async event(tx:Tx,orgId:string,actorId:string|null,action:string,requestId:string,membershipId:string|null,invitationId:string|null,metadata:Record<string,string|number|null>):Promise<void>{
    const safe={...metadata,policy_version:policyVersion};
    const rows=await tx<{id:string}[]>`INSERT INTO organization_actions(organization_id,actor_user_id,actor_kind,action,membership_id,invitation_id,request_id,safe_metadata)
      VALUES (${orgId},${actorId},${actorId?'USER':'SYSTEM'},${action},${membershipId},${invitationId},${requestId},${JSON.stringify(safe)}::jsonb) RETURNING id`;
    const payload={organization_id:orgId,action_id:rows[0]!.id,membership_id:membershipId,invitation_id:invitationId,action,version:metadata.organization_version??metadata.version??1,schema_version:1};
    await tx`INSERT INTO organization_outbox(action_id,organization_id,event_type,safe_payload) VALUES (${rows[0]!.id},${orgId},${action},${JSON.stringify(payload)}::jsonb)`;
    await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
      VALUES (${actorId},${action},'Organization',${orgId},'GOVERNANCE_COMMAND',${requestId},${JSON.stringify({...safe,membership_id:membershipId,invitation_id:invitationId})}::jsonb)`;
  }
  public async create(actor:OrganizationActor,input:Command&{legalName:string;publicName:string;organizationType:string;publicPhoneOptIn:boolean}):Promise<OrganizationSummary>{
    if(typeof input.legalName!=='string'||typeof input.publicName!=='string'||typeof input.publicPhoneOptIn!=='boolean'
      ||input.legalName.trim().length<2||input.legalName.trim().length>160||input.publicName.trim().length<2||input.publicName.trim().length>120
      ||!['REAL_ESTATE_AGENCY','PROPERTY_MANAGEMENT_COMPANY','CORPORATE_PROPERTY_OWNER'].includes(input.organizationType))
      throw denied(input.organizationType==='OTHER_APPROVED_PROVIDER'?'PRIVILEGED_GOVERNANCE_UNAVAILABLE':'INVALID_INPUT');
    const payload={legal_name:input.legalName.trim(),public_name:input.publicName.trim(),organization_type:input.organizationType,public_phone_opt_in:input.publicPhoneOptIn};
    return this.command(actor,'CREATE_ORGANIZATION',input,payload,async(tx,contact,prior)=>{
      if(prior){await this.organization(tx,actor.userId,prior.id);return this.summary(tx,actor.userId,prior.id);}
      const rows=await tx<{id:string}[]>`INSERT INTO organizations(state,legal_name,public_name,organization_type,public_phone,created_by_user_id,onboarding_contact_id,onboarding_completed_at)
        VALUES ('ACTIVE',${payload.legal_name},${payload.public_name},${input.organizationType},${input.publicPhoneOptIn?contact.normalized_e164:null},${actor.userId},${contact.id},transaction_timestamp()) RETURNING id`;
      const orgId=rows[0]!.id;
      const members=await tx<{id:string}[]>`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by,activated_at)
        VALUES (${orgId},${actor.userId},'OWNER','ACTIVE',${actor.userId},transaction_timestamp()) RETURNING id`;
      await tx`INSERT INTO provider_accounts(kind,organization_id,state) VALUES ('ORGANIZATION',${orgId},'DRAFT')`;
      await this.event(tx,orgId,actor.userId,'ORGANIZATION_CREATED',input.requestId,members[0]!.id,null,{version:1,organization_version:1,after_state:'ACTIVE',after_role:'OWNER'});
      await this.receipt(tx,actor,orgId,'CREATE_ORGANIZATION',input,payload,orgId);return this.summary(tx,actor.userId,orgId);
    });
  }
  public async list(actor:OrganizationActor,input:Page={}):Promise<{organizations:OrganizationSummary[];next_cursor:string|null}>{
    const{limit,cursor}=page(input);return this.transaction(actor,async tx=>{
      const rows=await tx<{id:string}[]>`SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id
        WHERE m.user_id=${actor.userId} AND m.state='ACTIVE' AND o.state='ACTIVE' AND o.onboarding_completed_at IS NOT NULL
        AND (${cursor}::uuid IS NULL OR o.id>${cursor}::uuid) ORDER BY o.id LIMIT ${limit+1}`;
      return{organizations:await Promise.all(rows.slice(0,limit).map(r=>this.summary(tx,actor.userId,r.id))),next_cursor:rows.length>limit?rows[limit-1]!.id:null};
    });
  }
  public async get(actor:OrganizationActor,orgId:string):Promise<OrganizationSummary>{
    return this.transaction(actor,async tx=>{await this.organization(tx,actor.userId,orgId);return this.summary(tx,actor.userId,orgId);});
  }
  public async members(actor:OrganizationActor,orgId:string,input:Page={}):Promise<{members:OrganizationMember[];next_cursor:string|null}>{
    const{limit,cursor}=page(input);return this.transaction(actor,async tx=>{
      await this.organization(tx,actor.userId,orgId,true);
      const rows=await tx<MemberRow[]>`SELECT id,organization_id,user_id,role,state,version,activated_at,revoked_at FROM organization_memberships
        WHERE organization_id=${orgId} AND (${cursor}::uuid IS NULL OR id>${cursor}::uuid) ORDER BY id LIMIT ${limit+1}`;
      return{members:rows.slice(0,limit).map(member),next_cursor:rows.length>limit?rows[limit-1]!.id:null};
    });
  }
  private async invitationRow(tx:Tx,id:string,lock=false):Promise<InvitationRow>{
    if(!uuid(id))throw denied();
    const rows=await tx<InvitationRow[]>`SELECT i.*,o.public_name AS organization_public_name,(i.expires_at<=transaction_timestamp()) AS expired
      FROM organization_invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.id=${id}
      ${lock?tx`FOR UPDATE OF i`:tx``}`;
    if(!rows[0])throw denied();return rows[0];
  }
  private contactMatches(r:InvitationRow,actorId:string,contact:Contact):boolean{
    return r.recipient_user_id===actorId&&r.recipient_contact_id===contact.id&&r.recipient_contact_version===contact.verification_version;
  }
  public async invitations(actor:OrganizationActor,input:Page&{organizationId?:string|undefined}={}):Promise<{invitations:OrganizationInvitation[];next_cursor:string|null}>{
    const{limit,cursor}=page(input);
    return this.transaction(actor,async(tx,contact)=>{
      if(input.organizationId)await this.organization(tx,actor.userId,input.organizationId,true);
      const rows=await tx<InvitationRow[]>`SELECT i.*,o.public_name AS organization_public_name,(i.expires_at<=transaction_timestamp()) AS expired
        FROM organization_invitations i JOIN organizations o ON o.id=i.organization_id WHERE o.state='ACTIVE' AND o.onboarding_completed_at IS NOT NULL
        AND ${input.organizationId?tx`i.organization_id=${input.organizationId}`:tx`i.recipient_user_id=${actor.userId} AND i.recipient_contact_id=${contact.id} AND i.recipient_contact_version=${contact.verification_version}`}
        AND (${cursor}::uuid IS NULL OR i.id>${cursor}::uuid) ORDER BY i.id LIMIT ${limit+1}`;
      return{invitations:rows.slice(0,limit).map(r=>invitation(r,actor.userId)),next_cursor:rows.length>limit?rows[limit-1]!.id:null};
    });
  }
  public async invite(actor:OrganizationActor,orgId:string,input:VersionCommand&{role:string;recipientPhone:string}):Promise<OrganizationInvitation>{
    const payload={organization_id:orgId,role:input.role,recipient_phone:input.recipientPhone,expected_version:input.expectedVersion};
    let deliveryInput:Parameters<OrganizationInvitationDelivery['deliver']>[0]|null=null;
    try { return await this.command(actor,'INVITE_MEMBER',input,payload,async(tx,_contact,prior)=>{
      const org=await this.organization(tx,actor.userId,orgId,true);
      if(!ordinary(input.role)){
        if(['OWNER','ADMIN'].includes(input.role))return this.privileged(tx,actor,orgId,'INVITE_MEMBER',input,payload);
        throw denied('INVALID_INPUT');
      }
      if(prior)return invitation(await this.invitationRow(tx,prior.id),actor.userId);
      if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw denied('INVALID_INPUT');
      if(org.version!==input.expectedVersion)throw denied('STALE_VERSION');
      if(!this.delivery)throw denied('DELIVERY_UNAVAILABLE');
      if(typeof input.recipientPhone!=='string'||!/^[+][1-9][0-9]{7,14}$/.test(input.recipientPhone))throw denied('INVALID_INPUT');
      const contacts=await tx<Contact[]>`SELECT p.id,p.user_id,p.normalized_e164,p.verification_version FROM phone_contacts p JOIN users u ON u.id=p.user_id
        WHERE p.normalized_e164=${input.recipientPhone} AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0 AND u.account_state='ACTIVE' FOR SHARE OF p,u`;
      const target=contacts[0];if(!target)throw denied();
      await this.expireOrganizationInvitations(tx,orgId);
      const current=await tx<{id:string}[]>`SELECT id FROM organization_memberships WHERE organization_id=${orgId} AND user_id=${target.user_id} AND state IN ('INVITED','ACTIVE','SUSPENDED')`;
      if(current[0])throw denied();
      const members=await tx<{id:string}[]>`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by,invited_by,invitation_expires_at)
        VALUES (${orgId},${target.user_id},${input.role},'INVITED',${actor.userId},${actor.userId},transaction_timestamp()+interval '168 hours') RETURNING id`;
      const token=randomBytes(32).toString('base64url');
      const rows=await tx<{id:string}[]>`INSERT INTO organization_invitations(organization_id,membership_id,recipient_user_id,recipient_contact_id,recipient_contact_version,invited_by,role,token_digest,expires_at)
        VALUES (${orgId},${members[0]!.id},${target.user_id},${target.id},${target.verification_version},${actor.userId},${input.role},${hash(token)},transaction_timestamp()+interval '168 hours') RETURNING id`;
      const row=await this.invitationRow(tx,rows[0]!.id);
      const version=await this.bump(tx,orgId);
      await this.event(tx,orgId,actor.userId,'INVITATION_CREATED',input.requestId,members[0]!.id,row.id,{version:1,organization_version:version,after_state:'INVITED',after_role:input.role});
      await this.receipt(tx,actor,orgId,'INVITE_MEMBER',input,payload,row.id);
      deliveryInput={recipientUserId:target.user_id,invitationId:row.id,token,expiresAt:timestamp(row.expires_at)};
      // This private adapter stages an in-memory token only. SQL effects remain
      // uncommitted, and rollback removes the staged token. No external send.
      try { await this.delivery!.deliver(deliveryInput); }
      catch { throw denied('DELIVERY_UNAVAILABLE'); }
      return invitation(row,actor.userId);
    }); } catch(error) {
      if(deliveryInput) {
        const staged=deliveryInput as Parameters<OrganizationInvitationDelivery['deliver']>[0];
        this.delivery?.forget(staged.recipientUserId,staged.invitationId);
      }
      throw error;
    }
  }
  private async recipientOrganization(tx:Tx,row:InvitationRow):Promise<void>{
    const org=await tx<{id:string}[]>`SELECT id FROM organizations WHERE id=${row.organization_id} AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL FOR UPDATE`;
    if(!org[0])throw denied();
  }
  private async terminalInvitation(tx:Tx,row:InvitationRow,state:'ACTIVE'|'DECLINED'|'REVOKED'|'EXPIRED',actorId:string|null,requestId:string):Promise<void>{
    const changedInvitation=await tx`UPDATE organization_invitations SET state=${state},token_consumed_at=transaction_timestamp(),version=version+1 WHERE id=${row.id} AND state='INVITED'`;
    const changedMember=await tx`UPDATE organization_memberships SET state=${state},version=version+1,changed_at=transaction_timestamp(),changed_by=${actorId??row.invited_by},
      activated_at=CASE WHEN ${state}='ACTIVE' THEN transaction_timestamp() ELSE activated_at END,
      revoked_at=CASE WHEN ${state}='REVOKED' THEN transaction_timestamp() ELSE revoked_at END WHERE id=${row.membership_id} AND state='INVITED'`;
    if(changedInvitation.count!==1||changedMember.count!==1)throw denied('STALE_VERSION');
    const version=await this.bump(tx,row.organization_id);
    const action={ACTIVE:'INVITATION_ACCEPTED',DECLINED:'INVITATION_DECLINED',REVOKED:'INVITATION_REVOKED',EXPIRED:'INVITATION_EXPIRED'}[state];
    await this.event(tx,row.organization_id,actorId,action,requestId,row.membership_id,row.id,{before_state:'INVITED',after_state:state,version:row.version+1,organization_version:version});
  }
  public async respondInvitation(actor:OrganizationActor,id:string,input:VersionCommand&{command:'ACCEPT'|'DECLINE';token:string}):Promise<OrganizationInvitation>{
    const operation=`${input.command}_INVITATION`;
    const payload={invitation_id:id,command:input.command,token_hash:hash(input.token),expected_version:input.expectedVersion};
    const result=await this.command(actor,operation,input,payload,async(tx,contact,prior)=>{
      const initial=await this.invitationRow(tx,id);
      if(!this.contactMatches(initial,actor.userId,contact))throw denied();
      await this.recipientOrganization(tx,initial);
      const row=await this.invitationRow(tx,id,true);
      const memberships=await tx<{state:MemberState;role:OrganizationRole}[]>`SELECT state,role FROM organization_memberships WHERE id=${row.membership_id} FOR SHARE`;
      if(prior){
        if(prior.id!==id||(input.command==='ACCEPT'&&(row.state!=='ACTIVE'||memberships[0]?.state!=='ACTIVE'||!ordinary(memberships[0]?.role))))throw denied();
        if(input.command==='DECLINE'&&row.state!=='DECLINED')throw denied();return invitation(row,actor.userId);
      }
      if(!['ACCEPT','DECLINE'].includes(input.command)||!Number.isInteger(input.expectedVersion)||input.expectedVersion<1||typeof input.token!=='string'||input.token.length>128)throw denied('INVALID_INPUT');
      if(row.state!=='INVITED'||memberships[0]?.state!=='INVITED'||memberships[0].role!==row.role||!ordinary(memberships[0].role))throw denied('INVITATION_UNAVAILABLE');
      if(row.expired){await this.terminalInvitation(tx,row,'EXPIRED',null,input.requestId);return denied('INVITATION_UNAVAILABLE');}
      if(row.version!==input.expectedVersion)throw denied('STALE_VERSION');
      if(!timingSafeEqual(Buffer.from(row.token_digest,'hex'),Buffer.from(hash(input.token),'hex')))throw denied('INVITATION_UNAVAILABLE');
      await this.terminalInvitation(tx,row,input.command==='ACCEPT'?'ACTIVE':'DECLINED',actor.userId,input.requestId);
      await this.receipt(tx,actor,row.organization_id,operation,input,payload,row.id);
      return invitation(await this.invitationRow(tx,id),actor.userId);
    });
    this.delivery?.forget(actor.userId,id);return result;
  }
  public async revokeInvitation(actor:OrganizationActor,orgId:string,id:string,input:VersionCommand):Promise<OrganizationInvitation>{
    const payload={organization_id:orgId,invitation_id:id,expected_version:input.expectedVersion};
    return this.command(actor,'REVOKE_INVITATION',input,payload,async(tx,_contact,prior)=>{
      await this.organization(tx,actor.userId,orgId,true);
      const row=await this.invitationRow(tx,id,true);if(row.organization_id!==orgId)throw denied();
      if(prior)return invitation(row,actor.userId);
      if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw denied('INVALID_INPUT');
      if(row.state!=='INVITED')throw denied('INVITATION_UNAVAILABLE');
      if(row.expired){await this.terminalInvitation(tx,row,'EXPIRED',null,input.requestId);return denied('INVITATION_UNAVAILABLE');}
      if(row.version!==input.expectedVersion)throw denied('STALE_VERSION');
      await this.terminalInvitation(tx,row,'REVOKED',actor.userId,input.requestId);
      await this.receipt(tx,actor,orgId,'REVOKE_INVITATION',input,payload,id);return invitation(await this.invitationRow(tx,id),actor.userId);
    });
  }
  public async mutateMember(actor:OrganizationActor,orgId:string,id:string,input:VersionCommand&{command:'CHANGE_ROLE'|'SUSPEND'|'REACTIVATE'|'REVOKE';role?:string|undefined}):Promise<OrganizationMember>{
    const operation=`MEMBER_${input.command}`;
    const payload={organization_id:orgId,membership_id:id,command:input.command,role:input.role??null,expected_version:input.expectedVersion};
    return this.command(actor,operation,input,payload,async(tx,_contact,prior)=>{
      await this.organization(tx,actor.userId,orgId,true);if(!uuid(id))throw denied();
      const rows=await tx<MemberRow[]>`SELECT id,organization_id,user_id,role,state,version,activated_at,revoked_at FROM organization_memberships WHERE id=${id} AND organization_id=${orgId} FOR UPDATE`;
      const row=rows[0];if(!row)throw denied();
      if(!ordinary(row.role)||['OWNER','ADMIN'].includes(input.role??''))return this.privileged(tx,actor,orgId,operation,input,payload);
      if(prior)return member(row);
      if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw denied('INVALID_INPUT');
      if(row.version!==input.expectedVersion)throw denied('STALE_VERSION');
      if(!['CHANGE_ROLE','SUSPEND','REACTIVATE','REVOKE'].includes(input.command)||(input.command==='CHANGE_ROLE'&&!ordinary(input.role))||(input.command!=='CHANGE_ROLE'&&input.role!==undefined))throw denied('INVALID_INPUT');
      if(!['ACTIVE','SUSPENDED'].includes(row.state)||(input.command==='SUSPEND'&&row.state!=='ACTIVE')||(input.command==='REACTIVATE'&&row.state!=='SUSPENDED'))throw denied('INVALID_STATE');
      const targetUsers=await tx<{account_state:string}[]>`SELECT account_state FROM users WHERE id=${row.user_id} FOR SHARE`;
      const targetPhones=await tx<{id:string}[]>`SELECT id FROM phone_contacts WHERE user_id=${row.user_id} AND verified_at IS NOT NULL AND replaced_at IS NULL FOR SHARE`;
      // Containment remains possible for an ineligible target. Granting a role
      // or reactivating rights additionally requires current participation.
      if((input.command==='REACTIVATE'||input.command==='CHANGE_ROLE')&&(targetUsers[0]?.account_state!=='ACTIVE'||!targetPhones[0]))throw denied();
      const state=input.command==='SUSPEND'?'SUSPENDED':input.command==='REACTIVATE'?'ACTIVE':input.command==='REVOKE'?'REVOKED':row.state;
      const role=input.command==='CHANGE_ROLE'?input.role!:row.role;
      const updated=await tx<MemberRow[]>`UPDATE organization_memberships SET state=${state},role=${role},version=version+1,changed_by=${actor.userId},changed_at=transaction_timestamp(),
        revoked_at=CASE WHEN ${state}='REVOKED' THEN transaction_timestamp() ELSE revoked_at END WHERE id=${id} RETURNING id,organization_id,user_id,role,state,version,activated_at,revoked_at`;
      const version=await this.bump(tx,orgId);
      const action={CHANGE_ROLE:'MEMBER_ROLE_CHANGED',SUSPEND:'MEMBER_SUSPENDED',REACTIVATE:'MEMBER_REACTIVATED',REVOKE:'MEMBER_REVOKED'}[input.command];
      await this.event(tx,orgId,actor.userId,action,input.requestId,id,null,{before_state:row.state,after_state:state,before_role:row.role,after_role:role,version:row.version+1,organization_version:version});
      await this.receipt(tx,actor,orgId,operation,input,payload,id);return member(updated[0]!);
    });
  }
  private async expireOrganizationInvitations(tx:Tx,orgId:string,limit=100):Promise<number>{
    const rows=await tx<InvitationRow[]>`SELECT i.*,o.public_name AS organization_public_name,true AS expired FROM organization_invitations i JOIN organizations o ON o.id=i.organization_id
      WHERE i.organization_id=${orgId} AND i.state='INVITED' AND i.expires_at<=transaction_timestamp() ORDER BY i.id LIMIT ${limit} FOR UPDATE OF i`;
    for(const row of rows)await this.terminalInvitation(tx,row,'EXPIRED',null,randomUUID());return rows.length;
  }
  /** Bounded local maintenance; command/read predicates enforce expiry without a worker. */
  public async expireInvitations(limit=100):Promise<number>{
    if(!Number.isInteger(limit)||limit<1||limit>100)throw denied('INVALID_INPUT');
    return this.client.begin(async tx=>{
      await tx`SET LOCAL TIME ZONE 'UTC'`;
      const orgs=await tx<{id:string}[]>`SELECT o.id FROM organizations o WHERE o.onboarding_completed_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM organization_invitations i WHERE i.organization_id=o.id AND i.state='INVITED' AND i.expires_at<=transaction_timestamp())
        ORDER BY o.id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      let expired=0;for(const org of orgs){expired+=await this.expireOrganizationInvitations(tx,org.id,limit-expired);if(expired>=limit)break;}
      return expired;
    }) as Promise<number>;
  }
}
