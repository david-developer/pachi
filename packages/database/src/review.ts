import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ViewingStore, actorNormalized, fail, instant, validId, type Authority, type Context, type Tx, type ViewingCommandOptions } from './viewing.js';
import { requireOrganizationResourceSession } from './organization-resource-actor.js';
import { lockListingRegion } from './region-publication.js';
import { readPublicListingVisibility } from './listing-visibility.js';
import { IdentityError } from './identity.js';
import type { OrganizationActor } from './organization-lifecycle.js';

export type ReviewDirection='SEEKER_TO_PROVIDER'|'PROVIDER_TO_SEEKER';
export type ReviewState='SUBMITTED_HELD'|'PUBLISHED'|'UNDER_REVIEW'|'HIDDEN'|'REMOVED'|'WITHDRAWN';
export type ReviewContent={rating:number;text?:string;criteria?:Partial<Record<'listing_accuracy'|'communication'|'reliability'|'transparency'|'overall_experience'|'appointment_attendance'|'respectful_conduct'|'overall_interaction',number>>};
export type ReviewSubmitInput=ReviewContent&{expected_version:number};
type Slot={id:string;interaction_id:string;viewing_id:string;direction:ReviewDirection;reviewer_subject_type:'User'|'ProviderAccount';reviewer_subject_id:string;target_type:'User'|'ProviderAccount';target_id:string;state:'OPEN'|'HELD'|'CONSUMED'|'EXPIRED'|'REVOKED';opens_at:Date;closes_at:Date;consumed_at:Date|null;version:number;policy_version:string};
type Review={id:string;eligibility_id:string;viewing_id:string;interaction_id:string;direction:ReviewDirection;reviewer_subject_type:'User'|'ProviderAccount';reviewer_subject_id:string;target_type:'User'|'ProviderAccount';target_id:string;author_user_id:string;membership_id:string|null;assignment_id:string|null;state:ReviewState;version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;published_at:Date|null;created_at:Date;updated_at:Date};
export type ReviewOwn={id:string;eligibility_id:string;viewing_id:string;interaction_id:string;direction:ReviewDirection;target_type:'USER'|'PROVIDER_ACCOUNT';target_id:string;state:ReviewState;version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;published_at:string|null;created_at:string;updated_at:string;can_edit:boolean;can_withdraw:boolean};
export type ReviewEligibilityRead={viewing_id:string;interaction_id:string;actor_side:'SEEKER'|'PROVIDER';eligibility:{id:string;direction:ReviewDirection;state:Slot['state'];opens_at:string;closes_at:string;policy_version:string;can_submit:boolean;version:number}|null;own_review:ReviewOwn|null};
export type ReviewPublished={id:string;direction:ReviewDirection;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;date:string;author_display_name:string;author_role:string;event_label:'VALIDATED_COMPLETED_VIEWING';provider_identity_verified:boolean};
export type ReviewPublishedPage={items:ReviewPublished[];next_cursor:string|null;reputation:{count:number;average:number|null}};
export type ReviewReportInput={reason:'HARASSMENT'|'DISCRIMINATION'|'THREATS'|'PRIVACY_EXPOSURE'|'EXTORTION'|'IMPERSONATION'|'IRRELEVANT_CONTENT'|'OTHER';details?:string};
export type ReviewReportRead={report:{id:string;review_id:string;state:'OPEN';review_status:'PENDING_REVIEW';created_at:string};replayed:boolean};
const score=z.number().int().min(1).max(5),unicode=z.string().refine(v=>Array.from(v).length<=2000),version=z.number().int().positive();
const criteria=z.object({listing_accuracy:score.optional(),communication:score.optional(),reliability:score.optional(),transparency:score.optional(),overall_experience:score.optional(),appointment_attendance:score.optional(),respectful_conduct:score.optional(),overall_interaction:score.optional()}).strict();
const content=z.object({expected_version:version,rating:score,text:unicode.optional(),criteria:criteria.optional()}).strict();
const withdrawSchema=z.object({expected_version:version}).strict();
const reportSchema=z.object({reason:z.enum(['HARASSMENT','DISCRIMINATION','THREATS','PRIVACY_EXPOSURE','EXTORTION','IMPERSONATION','IRRELEVANT_CONTENT','OTHER']),details:unicode.optional()}).strict();
const directionFor=(a:Authority):ReviewDirection=>a.side==='SEEKER'?'SEEKER_TO_PROVIDER':'PROVIDER_TO_SEEKER';

/** Review receipts retain references only. Every replay resolves current scope;
 * an organization principal never grants another member held authorship. */
export class ReviewStore extends ViewingStore {
  private async reviewAuthority(tx:Tx,actor:OrganizationActor,interactionId:string):Promise<Authority> {
    const initial=await this.context(tx,interactionId);await lockListingRegion(tx,initial.listing_id);
    if(initial.organization_id)await tx`SELECT id FROM organizations WHERE id=${initial.organization_id} FOR UPDATE`;
    const a=await this.authorize(tx,actor,interactionId);
    if(a.side==='PROVIDER'&&a.context.organization_id) {
      // The review matrix requires an assigned/delegated Interaction even for
      // OWNER/ADMIN. The broader Viewing operational grant is insufficient.
      const assignment=(await tx<{id:string;version:number}[]>`SELECT s.id,s.version FROM organization_resource_assignments s
        WHERE s.membership_id=${a.organization!.membershipId} AND s.provider_account_id=${a.context.provider_account_id}
          AND s.resource_type='INTERACTION' AND s.resource_id=${a.context.id} AND s.revoked_at IS NULL
          AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()) FOR SHARE`)[0];
      if(!assignment)fail('RESOURCE_SCOPE_DENIED');
      a.organization={...a.organization!,assignmentId:assignment.id,assignmentVersion:assignment.version};
    }
    await this.currentScope(tx,actor,a);return a;
  }
  private async safe(tx:Tx,c:Context):Promise<boolean> {
    // Publication status, market, region and expiry do not define the validity
    // of a completed experience. Safety, current principals and evidence do.
    await this.participantEligible(tx,c.seeker_user_id);
    if(c.provider_user_id)await this.participantEligible(tx,c.provider_user_id);
    if(c.organization_id) {
      // The current eligible organization actor may be a successor rather than
      // the historical author. Pin its phone and assignment through publication
      // so a concurrent loss cannot race the final eligibility recheck.
      await tx`SELECT u.id,p.id,s.id FROM organization_memberships m
        JOIN users u ON u.id=m.user_id JOIN phone_contacts p ON p.user_id=u.id
        JOIN organization_resource_assignments s ON s.membership_id=m.id
        WHERE m.organization_id=${c.organization_id} AND m.state='ACTIVE' AND m.role<>'ANALYST' AND u.account_state='ACTIVE'
          AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0
          AND s.provider_account_id=${c.provider_account_id} AND s.resource_type='INTERACTION' AND s.resource_id=${c.id}
          AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())
        ORDER BY u.id,p.id,s.id FOR SHARE OF u,p,s`;
    }
    if(c.provider_profile_id)await tx`SELECT provider_profile_id FROM verification_claims WHERE provider_profile_id=${c.provider_profile_id} FOR SHARE`;
    const valid=(await tx<{valid:boolean}[]>`SELECT review_context_valid(${c.id}) AS valid`)[0]!.valid;
    if(!valid)return false;
    if(c.provider_profile_id&&!this.allowSyntheticVerification&&(await tx`SELECT c.id FROM verification_claims v JOIN verification_cases c ON c.id=v.source_case_id
      WHERE v.provider_profile_id=${c.provider_profile_id} AND c.policy_version='provider-identity-synthetic-v1'`)[0])return false;
    return true;
  }
  private async slot(tx:Tx,id:string):Promise<Slot> {
    const e=(await tx<Slot[]>`SELECT * FROM viewing_review_eligibilities WHERE id=${id} FOR UPDATE`)[0];if(!e)fail('RESOURCE_SCOPE_DENIED');return e;
  }
  private async review(tx:Tx,id:string):Promise<Review> {
    const r=(await tx<Review[]>`SELECT * FROM reviews WHERE id=${id} FOR UPDATE`)[0];if(!r)fail('RESOURCE_SCOPE_DENIED');return r;
  }
  private async ownProjection(tx:Tx,actor:OrganizationActor,a:Authority,r:Review,e:Slot):Promise<ReviewOwn> {
    if(r.author_user_id!==actor.userId)fail('RESOURCE_SCOPE_DENIED');
    const before=(await tx<{before:boolean}[]>`SELECT statement_timestamp()<closes_at AS before FROM viewing_review_eligibilities WHERE id=${e.id}`)[0]!.before;
    const canEdit=r.state==='SUBMITTED_HELD'&&before&&await this.safe(tx,a.context)&&await this.participantEligible(tx,actor.userId);
    await this.currentScope(tx,actor,a);
    return {id:r.id,eligibility_id:r.eligibility_id,viewing_id:r.viewing_id,interaction_id:r.interaction_id,direction:r.direction,
      target_type:r.target_type==='User'?'USER':'PROVIDER_ACCOUNT',target_id:r.target_id,state:r.state,version:r.version,rating:r.rating,text:r.text,criteria:r.criteria,
      published_at:instant(r.published_at),created_at:instant(r.created_at)!,updated_at:instant(r.updated_at)!,can_edit:canEdit,can_withdraw:r.state!=='WITHDRAWN'};
  }
  async eligibility(actorInput:OrganizationActor,viewingInput:string):Promise<ReviewEligibilityRead> {
    const actor=actorNormalized(actorInput),id=validId(viewingInput);
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
      const a=await this.reviewAuthority(tx,actor,seed.interaction_id);
      const e=(await tx<Slot[]>`SELECT * FROM viewing_review_eligibilities WHERE viewing_id=${id} AND direction=${directionFor(a)} FOR UPDATE`)[0]??null;
      const r=e?(await tx<Review[]>`SELECT * FROM reviews WHERE eligibility_id=${e.id} AND author_user_id=${actor.userId} FOR UPDATE`)[0]??null:null;
      const can=e?.state==='OPEN'&&await this.safe(tx,a.context)&&await this.participantEligible(tx,actor.userId)
        &&!!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND opens_at<=statement_timestamp() AND statement_timestamp()<closes_at`)[0];
      await this.currentScope(tx,actor,a);
      return {viewing_id:id,interaction_id:a.context.id,actor_side:a.side,eligibility:e?{id:e.id,direction:e.direction,state:e.state,opens_at:instant(e.opens_at)!,closes_at:instant(e.closes_at)!,policy_version:e.policy_version,can_submit:!!can,version:e.version}:null,
        own_review:r?await this.ownProjection(tx,actor,a,r,e!):null};
    });
  }
  private checkCriteria(direction:ReviewDirection,input:ReviewContent) {
    const allowed=direction==='SEEKER_TO_PROVIDER'?['listing_accuracy','communication','reliability','transparency','overall_experience']:['communication','reliability','appointment_attendance','respectful_conduct','overall_interaction'];
    if(Object.keys(input.criteria??{}).some(k=>!allowed.includes(k)))fail('INVALID_INPUT');
  }
  private async event(tx:Tx,e:Slot,r:Review|null,eventType:string,actor:OrganizationActor|null,requestId?:string,eventVersion?:number) {
    await tx`INSERT INTO review_events(eligibility_id,review_id,interaction_id,viewing_id,direction,event_type,version,actor_user_id,request_id,policy_version)
      VALUES(${e.id},${r?.id??null},${e.interaction_id},${e.viewing_id},${e.direction},${eventType},${eventVersion??r?.version??e.version},${actor?.userId??null},${requestId??null},${e.policy_version}) ON CONFLICT DO NOTHING`;
  }
  private async reconcile(tx:Tx,c:Context) {
    // One stable lock per reputation subject serializes aggregate updates across
    // distinct Interactions while each interaction keeps its parent-row lock.
    const subjects=[{type:'ProviderAccount',id:c.provider_account_id},{type:'User',id:c.seeker_user_id}].sort((a,b)=>`${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
    for(const subject of subjects){
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-reputation:${subject.type}:${subject.id}`},0))`;
      await tx`INSERT INTO review_reputation(target_type,target_id,published_count,rating_sum)
        SELECT ${subject.type},${subject.id},count(*)::integer,coalesce(sum(rating),0)::integer FROM eligible_published_reviews WHERE target_type=${subject.type} AND target_id=${subject.id}
        ON CONFLICT(target_type,target_id) DO UPDATE SET published_count=EXCLUDED.published_count,rating_sum=EXCLUDED.rating_sum,reconciled_at=statement_timestamp()`;
    }
  }
  private async reveal(tx:Tx,c:Context):Promise<number> {
    const slots=await tx<Slot[]>`SELECT * FROM viewing_review_eligibilities WHERE interaction_id=${c.id} ORDER BY id FOR UPDATE`;
    const reviews=await tx<Review[]>`SELECT * FROM reviews WHERE interaction_id=${c.id} ORDER BY id FOR UPDATE`;
    for(const author of [...new Set(reviews.map(r=>r.author_user_id))].sort())await this.participantEligible(tx,author);
    if(!(await this.safe(tx,c)))return 0;
    const eligible:Review[]=[];
    for(const r of reviews)if(r.state==='SUBMITTED_HELD'&&slots.some(e=>e.id===r.eligibility_id&&e.state==='CONSUMED')
      &&(await tx<{current:boolean}[]>`SELECT review_author_current(${r.id}) AS current`)[0]!.current)eligible.push(r);
    const reciprocal=reviews.length===2&&eligible.length===2;
    let published=0;
    // Waiting for events/notices cannot carry an expired authority decision.
    await tx`LOCK TABLE review_events,review_outbox,viewing_notices,audit_events IN ROW EXCLUSIVE MODE`;
    if(!(await this.safe(tx,c)))return 0;
    for(const r of eligible){
      const e=slots.find(e=>e.id===r.eligibility_id)!;
      if(!reciprocal&&!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND closes_at<=statement_timestamp()`)[0])continue;
      const updated=(await tx<Review[]>`UPDATE reviews SET state='PUBLISHED',version=version+1,published_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=${r.id} AND state='SUBMITTED_HELD' RETURNING *`)[0]!;
      await this.event(tx,e,updated,'review_published',null);published++;
    }
    if(published){
      if(!(await this.safe(tx,c)))fail('CAPABILITY_RESTRICTED');
      for(const r of eligible)if(!(await tx<{current:boolean}[]>`SELECT review_author_current(${r.id}) AS current`)[0]!.current)fail('CAPABILITY_RESTRICTED');
      await this.reconcile(tx,c);
    }
    return published;
  }
  private async reviewCommand(actorInput:OrganizationActor,resourceInput:string,operation:'SUBMIT'|'EDIT'|'WITHDRAW',input:ReviewSubmitInput|{expected_version:number},options:ViewingCommandOptions):Promise<{review:ReviewOwn;replayed:boolean}> {
    const actor=actorNormalized(actorInput),id=validId(resourceInput),key=validId(options.idempotencyKey,'INVALID_INPUT');
    if(options.requestId!==undefined)validId(options.requestId,'INVALID_INPUT');
    const normalized='rating' in input?{expected_version:input.expected_version,rating:input.rating,text:input.text??null,criteria:Object.fromEntries(Object.entries(input.criteria??{}).sort(([a],[b])=>a.localeCompare(b)))}:input;
    const hash=createHash('sha256').update(JSON.stringify({operation,resource:id,...normalized})).digest('hex');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;await requireOrganizationResourceSession(tx,actor,false);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-command:${actor.userId}:${key}`},0))`;
      const prior=(await tx<{request_hash:string;review_id:string}[]>`SELECT request_hash,review_id FROM review_command_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${key}`)[0];
      if(prior&&prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');
      const seed=operation==='SUBMIT'?(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewing_review_eligibilities WHERE id=${id}`)[0]
        :(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM reviews WHERE id=${id}`)[0];
      if(!seed)fail('RESOURCE_SCOPE_DENIED');
      const a=await this.reviewAuthority(tx,actor,seed.interaction_id);
      // Lock both slots in canonical order before any review: reciprocal submit,
      // edit, withdrawal and leased reveal all use the same parent serialization.
      await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${seed.interaction_id} ORDER BY id FOR UPDATE`;
      let r:Review,e:Slot;
      if(prior){r=await this.review(tx,prior.review_id);e=await this.slot(tx,r.eligibility_id);}
      else if(operation==='SUBMIT'){
        e=await this.slot(tx,id);if(e.direction!==directionFor(a))fail('RESOURCE_SCOPE_DENIED');
        if(e.version!==input.expected_version)fail('STALE_VERSION');
        if(e.state!=='OPEN')fail('REVIEW_ELIGIBILITY_UNAVAILABLE');
        if(!(await this.safe(tx,a.context))||!(await this.participantEligible(tx,actor.userId)))fail('CAPABILITY_RESTRICTED');
        if(!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND opens_at<=statement_timestamp() AND statement_timestamp()<closes_at`)[0])fail('REVIEW_WINDOW_CLOSED');
        const data=input as ReviewSubmitInput;this.checkCriteria(e.direction,data);
        r=(await tx<Review[]>`INSERT INTO reviews(eligibility_id,interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,author_user_id,membership_id,assignment_id,target_type,target_id,rating,text,criteria,policy_version)
          VALUES(${e.id},${e.interaction_id},${e.viewing_id},${e.direction},${e.reviewer_subject_type},${e.reviewer_subject_id},${actor.userId},${a.organization?.membershipId??null},${a.organization?.assignmentId??null},${e.target_type},${e.target_id},${data.rating},${data.text??null},${JSON.stringify(data.criteria??{})}::text::jsonb,${e.policy_version}) RETURNING *`)[0]!;
        e=(await tx<Slot[]>`UPDATE viewing_review_eligibilities SET state='CONSUMED',consumed_at=statement_timestamp(),version=version+1 WHERE id=${e.id} RETURNING *`)[0]!;
        await this.event(tx,e,r,'review_submitted',actor,options.requestId);await this.currentScope(tx,actor,a);
        if(!(await this.safe(tx,a.context))||!(await this.participantEligible(tx,actor.userId)))fail('CAPABILITY_RESTRICTED');
        if(!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND statement_timestamp()<closes_at`)[0])fail('REVIEW_WINDOW_CLOSED');
        await this.reveal(tx,a.context);r=await this.review(tx,r.id);
      }else{
        r=await this.review(tx,id);e=await this.slot(tx,r.eligibility_id);
        if(r.author_user_id!==actor.userId||r.direction!==directionFor(a))fail('RESOURCE_SCOPE_DENIED');
        if(r.version!==input.expected_version)fail('STALE_VERSION');
        if(operation==='EDIT'){
          if(r.state!=='SUBMITTED_HELD')fail('REVIEW_LOCKED');
          if(!(await this.safe(tx,a.context))||!(await this.participantEligible(tx,actor.userId)))fail('CAPABILITY_RESTRICTED');
          if(!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND statement_timestamp()<closes_at`)[0])fail('REVIEW_WINDOW_CLOSED');
          const data=input as ReviewSubmitInput;this.checkCriteria(r.direction,data);
          r=(await tx<Review[]>`UPDATE reviews SET rating=${data.rating},text=${data.text??null},criteria=${JSON.stringify(data.criteria??{})}::text::jsonb,version=version+1,updated_at=statement_timestamp() WHERE id=${id} RETURNING *`)[0]!;
          await this.event(tx,e,r,'review_edited',actor,options.requestId);
          if(!(await this.safe(tx,a.context))||!(await this.participantEligible(tx,actor.userId)))fail('CAPABILITY_RESTRICTED');
          if(!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND statement_timestamp()<closes_at`)[0])fail('REVIEW_WINDOW_CLOSED');
        }else{
          if(r.state==='WITHDRAWN')fail('REVIEW_LOCKED');
          r=(await tx<Review[]>`UPDATE reviews SET state='WITHDRAWN',withdrawn_at=statement_timestamp(),version=version+1,updated_at=statement_timestamp() WHERE id=${id} RETURNING *`)[0]!;
          await this.event(tx,e,r,'review_withdrawn',actor,options.requestId);await this.reconcile(tx,a.context);
        }
      }
      if(r.author_user_id!==actor.userId||r.direction!==directionFor(a))fail('RESOURCE_SCOPE_DENIED');
      if(!prior)await tx`INSERT INTO review_command_receipts(actor_user_id,idempotency_key,operation,request_hash,review_id) VALUES(${actor.userId},${key},${operation},${hash},${r.id})`;
      return {review:await this.ownProjection(tx,actor,a,r,e),replayed:!!prior};
    });
  }
  async submit(actor:OrganizationActor,id:string,input:ReviewSubmitInput,options:ViewingCommandOptions){const parsed=content.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.reviewCommand(actor,id,'SUBMIT',parsed.data,options);}
  async edit(actor:OrganizationActor,id:string,input:ReviewSubmitInput,options:ViewingCommandOptions){const parsed=content.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.reviewCommand(actor,id,'EDIT',parsed.data,options);}
  async withdraw(actor:OrganizationActor,id:string,input:{expected_version:number},options:ViewingCommandOptions){const parsed=withdrawSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.reviewCommand(actor,id,'WITHDRAW',parsed.data,options);}
  async own(actorInput:OrganizationActor,idInput:string):Promise<ReviewOwn>{
    const actor=actorNormalized(actorInput),id=validId(idInput);
    return this.client.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE MODE`;const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM reviews WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
      const a=await this.reviewAuthority(tx,actor,seed.interaction_id);await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${seed.interaction_id} ORDER BY id FOR UPDATE`;
      const r=await this.review(tx,id),e=await this.slot(tx,r.eligibility_id);return this.ownProjection(tx,actor,a,r,e);});
  }
  private page(input:{cursor?:string;limit?:number}):number {
    const limit=input.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>50||Object.keys(input).some(k=>!['cursor','limit'].includes(k)))fail('INVALID_INPUT');if(input.cursor)validId(input.cursor,'INVALID_INPUT');return limit;
  }
  private async published(tx:Tx,targetType:'User'|'ProviderAccount',id:string,input:{cursor?:string;limit?:number},textInteraction?:string):Promise<ReviewPublishedPage> {
    const limit=this.page(input);
    // One SQL statement supplies count/sum and page from the same live snapshot.
    const row=(await tx<{items:(Review&{author_display_name:string;author_role:string;identity_current:boolean})[];count:number;sum:number}[]>`WITH eligible AS (
      SELECT r.*,coalesce(CASE WHEN r.direction='PROVIDER_TO_SEEKER' THEN coalesce(org.public_name,pp.display_name) ELSE u.display_name END,
        CASE WHEN r.direction='PROVIDER_TO_SEEKER' THEN 'Provider' ELSE 'Seeker' END) AS author_display_name,
        CASE WHEN r.direction='PROVIDER_TO_SEEKER' THEN CASE WHEN pa.kind='ORGANIZATION' THEN 'ORGANIZATION_PROVIDER' ELSE 'INDIVIDUAL_PROVIDER' END ELSE 'SEEKER' END AS author_role,
        EXISTS(SELECT 1 FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id WHERE vc.provider_profile_id=pp.id AND vc.status='VERIFIED'
          AND vc.valid_from<=statement_timestamp() AND vc.valid_until>statement_timestamp() AND vc.revoked_at IS NULL AND (${this.allowSyntheticVerification} OR c.policy_version<>'provider-identity-synthetic-v1')) AS identity_current
      FROM eligible_published_reviews r JOIN users u ON u.id=r.author_user_id JOIN interactions i ON i.id=r.interaction_id
      JOIN provider_accounts pa ON pa.id=i.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id LEFT JOIN organizations org ON org.id=pa.organization_id
      WHERE r.target_type=${targetType} AND r.target_id=${id}
        AND (${this.allowSyntheticVerification} OR NOT EXISTS(SELECT 1 FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id WHERE vc.provider_profile_id=pp.id AND c.policy_version='provider-identity-synthetic-v1'))),
     page AS(SELECT * FROM eligible WHERE TRUE ${textInteraction?tx`AND interaction_id=${textInteraction}`:tx``} ${input.cursor?tx`AND id<${input.cursor}`:tx``} ORDER BY id DESC LIMIT ${limit+1})
     SELECT coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY id DESC) FROM page),'[]'::jsonb) AS items,(SELECT count(*)::integer FROM eligible) AS count,
       (SELECT coalesce(sum(rating),0)::integer FROM eligible) AS sum`)[0]!;
    return {items:row.items.slice(0,limit).map(r=>({id:r.id,direction:r.direction,rating:r.rating,text:targetType==='User'||textInteraction?r.text:null,criteria:r.criteria,date:instant(r.published_at)!.slice(0,10),author_display_name:r.author_display_name,author_role:r.author_role,event_label:'VALIDATED_COMPLETED_VIEWING',provider_identity_verified:r.identity_current})),
      next_cursor:row.items.length>limit?row.items[limit-1]!.id:null,reputation:{count:row.count,average:row.count>=3?row.sum/row.count:null}};
  }
  async publishedProvider(providerInput:string,input:{cursor?:string;limit?:number}={}):Promise<ReviewPublishedPage>{
    const id=validId(providerInput);this.page(input);return this.client.begin(tx=>this.published(tx,'ProviderAccount',id,input));
  }
  async publishedProviderForActor(actorInput:OrganizationActor,providerInput:string,input:{interaction_id:string;cursor?:string;limit?:number}):Promise<ReviewPublishedPage>{
    const actor=actorNormalized(actorInput),id=validId(providerInput),{interaction_id,...page}=input;validId(interaction_id,'INVALID_INPUT');this.page(page);
    return this.client.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE MODE`;const a=await this.reviewAuthority(tx,actor,interaction_id);
      if(a.context.provider_account_id!==id)fail('RESOURCE_SCOPE_DENIED');await this.currentScope(tx,actor,a);
      return this.published(tx,'ProviderAccount',id,page,a.context.id);
    });
  }
  async publishedListing(listingInput:string,input:{cursor?:string;limit?:number}={}):Promise<ReviewPublishedPage>{
    const id=validId(listingInput);this.page(input);return this.client.begin(async tx=>{
      const visibility=await readPublicListingVisibility(tx,id,{allowSyntheticVerification:this.allowSyntheticVerification});if(!visibility.visible)fail('PUBLIC_LISTING_NOT_FOUND');
      const provider=(await tx<{provider_account_id:string}[]>`SELECT provider_account_id FROM listings WHERE id=${id}`)[0];if(!provider)fail('PUBLIC_LISTING_NOT_FOUND');
      return this.published(tx,'ProviderAccount',provider.provider_account_id,input);
    });
  }
  async publishedSeeker(actorInput:OrganizationActor,seekerInput:string,input:{interaction_id?:string;cursor?:string;limit?:number}={}):Promise<ReviewPublishedPage>{
    const actor=actorNormalized(actorInput),id=validId(seekerInput),{interaction_id,...page}=input;this.page(page);if(interaction_id)validId(interaction_id,'INVALID_INPUT');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;await requireOrganizationResourceSession(tx,actor,false);
      if(actor.userId!==id){if(!interaction_id)fail('RESOURCE_SCOPE_DENIED');const a=await this.reviewAuthority(tx,actor,interaction_id);if(a.side!=='PROVIDER'||a.context.seeker_user_id!==id)fail('RESOURCE_SCOPE_DENIED');await this.currentScope(tx,actor,a);}
      else if(interaction_id){const a=await this.reviewAuthority(tx,actor,interaction_id);if(a.context.seeker_user_id!==id)fail('RESOURCE_SCOPE_DENIED');}
      return this.published(tx,'User',id,page,actor.userId===id?undefined:interaction_id);
    });
  }
  async report(actorInput:OrganizationActor,reviewInput:string,input:ReviewReportInput,options:ViewingCommandOptions):Promise<ReviewReportRead>{
    const actor=actorNormalized(actorInput),id=validId(reviewInput),key=validId(options.idempotencyKey,'INVALID_INPUT'),parsed=reportSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    if(options.requestId!==undefined)validId(options.requestId,'INVALID_INPUT');
    const hash=createHash('sha256').update(JSON.stringify({operation:'REPORT',resource:id,reason:parsed.data.reason,details:parsed.data.details??null})).digest('hex');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;await requireOrganizationResourceSession(tx,actor,false);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-command:${actor.userId}:${key}`},0))`;
      const prior=(await tx<{request_hash:string;report_id:string}[]>`SELECT request_hash,report_id FROM review_command_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${key}`)[0];
      if(prior&&prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');
      const seed=(await tx<Review[]>`SELECT * FROM reviews WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
      // Published provider content is public; seeker content is participant/self
      // scoped. Held content remains author-only even when reporting.
      let a:Authority|null=null;
      if(seed.author_user_id===actor.userId||seed.target_type==='User')a=await this.reviewAuthority(tx,actor,seed.interaction_id);
      else {
        try{a=await this.reviewAuthority(tx,actor,seed.interaction_id);}
        catch(error){if(!(error instanceof IdentityError)||error.code!=='RESOURCE_SCOPE_DENIED')throw error;await requireOrganizationResourceSession(tx,actor,true);
          const c=await this.context(tx,seed.interaction_id);await lockListingRegion(tx,c.listing_id);if(c.organization_id)await tx`SELECT id FROM organizations WHERE id=${c.organization_id} FOR UPDATE`;await this.lockContext(tx,c);}
      }
      const r=await this.review(tx,id),e=await this.slot(tx,r.eligibility_id);
      if(r.author_user_id!==actor.userId){
        // A current participant can report content that was legitimately
        // revealed even after withdrawal. This does not disclose retained text
        // or authorize reports against a never-revealed counterpart review.
        if(r.state!=='PUBLISHED'&&!(a&&r.published_at!==null))fail('RESOURCE_SCOPE_DENIED');
        if(r.target_type==='User'&&!(actor.userId===r.target_id||(a?.side==='PROVIDER'&&a.context.seeker_user_id===r.target_id)))fail('RESOURCE_SCOPE_DENIED');
        if(!a){
          if(!(await tx`SELECT id FROM eligible_published_reviews WHERE id=${id}`)[0])fail('RESOURCE_SCOPE_DENIED');
          if(!(await this.safe(tx,await this.context(tx,r.interaction_id))))fail('RESOURCE_SCOPE_DENIED');
        }
      }
      let report:{id:string;review_id:string;created_at:Date};
      let duplicate=false;
      if(prior){report=(await tx<{id:string;review_id:string;created_at:Date}[]>`SELECT id,review_id,created_at FROM review_reports WHERE id=${prior.report_id} AND reporter_user_id=${actor.userId}`)[0]!;if(!report)fail('RESOURCE_SCOPE_DENIED');}
      else{
        const recent=(await tx<{id:string;review_id:string;created_at:Date}[]>`SELECT id,review_id,created_at FROM review_reports
          WHERE review_id=${id} AND reporter_user_id=${actor.userId} AND reason=${parsed.data.reason} AND details IS NOT DISTINCT FROM ${parsed.data.details??null}
            AND created_at>statement_timestamp()-interval '24 hours' ORDER BY created_at DESC,id DESC LIMIT 1`)[0];
        if(recent){report=recent;duplicate=true;}
        else{
          await tx`INSERT INTO review_moderation_cases(review_id) VALUES(${id}) ON CONFLICT(review_id) DO NOTHING`;
          const c=(await tx<{id:string}[]>`SELECT id FROM review_moderation_cases WHERE review_id=${id}`)[0]!;
          report=(await tx<{id:string;review_id:string;created_at:Date}[]>`INSERT INTO review_reports(case_id,review_id,reporter_user_id,reason,details,request_id) VALUES(${c.id},${id},${actor.userId},${parsed.data.reason},${parsed.data.details??null},${options.requestId??null}) RETURNING id,review_id,created_at`)[0]!;
          const n=(await tx<{n:number}[]>`SELECT count(*)::integer AS n FROM review_reports WHERE review_id=${id}`)[0]!.n;
          await this.event(tx,e,r,'review_reported',actor,options.requestId,n);
        }
        await tx`INSERT INTO review_command_receipts(actor_user_id,idempotency_key,operation,request_hash,review_id,report_id) VALUES(${actor.userId},${key},'REPORT',${hash},${id},${report.id})`;
      }
      await requireOrganizationResourceSession(tx,actor,false);if(a)await this.currentScope(tx,actor,a);
      return {report:{id:report.id,review_id:report.review_id,state:'OPEN',review_status:'PENDING_REVIEW',created_at:instant(report.created_at)!},replayed:!!prior||duplicate};
    });
  }
  private async maintenanceContext(tx:Tx,id:string):Promise<Context>{
    await tx`LOCK TABLE block_relationships IN SHARE MODE`;const initial=await this.context(tx,id);await lockListingRegion(tx,initial.listing_id);
    if(initial.organization_id)await tx`SELECT id FROM organizations WHERE id=${initial.organization_id} FOR UPDATE`;
    return this.lockContext(tx,initial);
  }
  async reviewsOnce(limit=50):Promise<{published:number;processed:number;skipped:number;pending:number}>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_INPUT');const token=randomUUID();
    const jobs=await this.client.begin(async tx=>tx<{id:string;interaction_id:string;eligibility_id:string}[]>`UPDATE review_scheduled_actions SET state='LEASED',lease_token=${token},lease_until=statement_timestamp()+interval '1 minute',attempts=attempts+1
      WHERE id IN(SELECT id FROM review_scheduled_actions WHERE due_at<=statement_timestamp() AND (state='PENDING' OR (state='LEASED' AND lease_until<=statement_timestamp()))
        ORDER BY last_checked_at NULLS FIRST,due_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING id,eligibility_id,(SELECT interaction_id FROM viewing_review_eligibilities WHERE id=eligibility_id) AS interaction_id`);
    let published=0,processed=0,skipped=0,pending=0;
    for(const job of jobs){
      try{const result=await this.client.begin(async tx=>{
        const c=await this.maintenanceContext(tx,job.interaction_id);
        await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${c.id} ORDER BY id FOR UPDATE`;
        const e=await this.slot(tx,job.eligibility_id);
        await tx`SELECT id FROM reviews WHERE interaction_id=${c.id} ORDER BY id FOR UPDATE`;
        const action=(await tx<{id:string;action_type:'REVEAL_DEADLINE'|'REMINDER_3D'|'REMINDER_1D';expected_eligibility_version:number;due_at:Date}[]>`SELECT * FROM review_scheduled_actions WHERE id=${job.id} AND state='LEASED' AND lease_token=${token} FOR UPDATE`)[0];
        if(!action)return {kind:'busy',published:0};
        const finish=async(kind:'PROCESSED'|'SKIPPED'|'PENDING',reason:string|null,count=0)=>{
          await tx`UPDATE review_scheduled_actions SET state=${kind},reason_code=${reason},lease_token=NULL,lease_until=NULL,last_checked_at=statement_timestamp(),processed_at=${kind==='PENDING'?tx`NULL`:tx`statement_timestamp()`} WHERE id=${action.id}`;
          return {kind:kind.toLowerCase(),published:count};
        };
        if(action.action_type==='REVEAL_DEADLINE'){
          if(!(await tx`SELECT 1 FROM viewing_review_eligibilities WHERE id=${e.id} AND closes_at<=statement_timestamp()`)[0])return finish('PENDING',null);
          if(!(await this.safe(tx,c)))return finish('PENDING','SAFETY_HOLD');
          const n=await this.reveal(tx,c);
          if(e.state==='CONSUMED'&&(await tx`SELECT id FROM reviews WHERE eligibility_id=${e.id} AND state IN ('SUBMITTED_HELD','UNDER_REVIEW','HIDDEN')`)[0])return finish('PENDING','SAFETY_HOLD',n);
          if(e.state==='OPEN')await tx`UPDATE viewing_review_eligibilities SET state='EXPIRED',version=version+1 WHERE id=${e.id}`;
          await this.event(tx,e,null,'review_window_closed',null,undefined,e.version);
          return finish('PROCESSED',null,n);
        }
        // Each reminder occupies a bounded future interval; the 3-day window
        // ends at the 1-day milestone, and the 1-day window at closure.
        const inWindow=async()=>!!(await tx`SELECT 1 FROM review_scheduled_actions a JOIN viewing_review_eligibilities slot ON slot.id=a.eligibility_id
          WHERE a.id=${action.id} AND a.due_at<=statement_timestamp() AND statement_timestamp()<review_utc_days_before(slot.closes_at,${action.action_type==='REMINDER_3D'?1:0})`)[0];
        if(e.state!=='OPEN'||e.version!==action.expected_eligibility_version)return finish('SKIPPED','INELIGIBLE_SLOT');
        if(!(await inWindow()))return finish('SKIPPED','MISSED_WINDOW');
        if(!(await this.safe(tx,c)))return finish('SKIPPED','SAFETY_HOLD');
        await tx`LOCK TABLE viewing_notices IN ROW EXCLUSIVE MODE`;
        if(!(await this.safe(tx,c))||!(await inWindow()))return finish('SKIPPED','MISSED_OR_INELIGIBLE');
        await tx`INSERT INTO viewing_notices(viewing_id,source_review_action_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
          SELECT v.id,${action.id},${e.direction==='SEEKER_TO_PROVIDER'?'SEEKER':'PROVIDER'},${e.direction==='SEEKER_TO_PROVIDER'?c.seeker_user_id:null},${e.direction==='PROVIDER_TO_SEEKER'?c.provider_account_id:null},${action.action_type==='REMINDER_3D'?'review_reminder_3d':'review_reminder_1d'},v.schedule_version,statement_timestamp()
          FROM viewings v WHERE v.id=${e.viewing_id} ON CONFLICT DO NOTHING`;
        if(!(await this.safe(tx,c))||!(await inWindow()))fail('CAPABILITY_RESTRICTED');
        return finish('PROCESSED',null);
      });published+=result.published;if(result.kind==='processed')processed++;if(result.kind==='skipped')skipped++;if(result.kind==='pending')pending++;}
      catch(error){if(!(error instanceof IdentityError)||!['RESOURCE_SCOPE_DENIED','CAPABILITY_RESTRICTED'].includes(error.code))throw error;
        await this.client`UPDATE review_scheduled_actions SET state='PENDING',lease_token=NULL,lease_until=NULL,last_checked_at=statement_timestamp(),reason_code='SAFETY_HOLD' WHERE id=${job.id} AND state='LEASED' AND lease_token=${token}`;pending++;}
    }
    return {published,processed,skipped,pending};
  }
  async reconcileOnce(limit=50):Promise<{reconciled:number}>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_INPUT');
    const subjects=await this.client<{target_type:'User'|'ProviderAccount';target_id:string}[]>`SELECT target_type,target_id FROM(
      SELECT target_type,target_id FROM reviews UNION SELECT target_type,target_id FROM review_reputation) subjects
      LEFT JOIN review_reputation p USING(target_type,target_id) ORDER BY p.reconciled_at NULLS FIRST,target_type,target_id LIMIT ${limit}`;
    for(const subject of subjects)await this.client.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-reputation:${subject.target_type}:${subject.target_id}`},0))`;
      await tx`INSERT INTO review_reputation(target_type,target_id,published_count,rating_sum)
        SELECT ${subject.target_type},${subject.target_id},count(*)::integer,coalesce(sum(rating),0)::integer FROM eligible_published_reviews WHERE target_type=${subject.target_type} AND target_id=${subject.target_id}
        ON CONFLICT(target_type,target_id) DO UPDATE SET published_count=EXCLUDED.published_count,rating_sum=EXCLUDED.rating_sum,reconciled_at=statement_timestamp()`;
    });return {reconciled:subjects.length};
  }
}
