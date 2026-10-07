// Synthetic TEST fixture only. Callers guard localhost:5433/pachi_test.
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { OrganizationStore, type OrganizationActor } from './organization-lifecycle.js';
import type { OrganizationResource } from './organization-resource-actor.js';
export async function organizationAssignmentFixture(client: postgres.Sql) {
  const names = ['owner','admin','manager','agent','analyst','unrelated','otherOwner','invited','suspended','revoked'] as const;
  const actors = {} as Record<typeof names[number],OrganizationActor>;
  for (const [index,name] of names.entries()) {
    const user = (await client<{id:string}[]>`INSERT INTO users(account_state) VALUES('ACTIVE') RETURNING id`)[0]!.id;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES(${user},${`+23769977710${index}`},statement_timestamp(),1)`;
    const session = (await client<{id:string}[]>`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at)
      VALUES(${user},'https://local.test/assignments','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`)[0]!.id;
    actors[name] = {userId:user,sessionId:session,securityVersion:0};
  }
  const lifecycle = new OrganizationStore(client);
  const profile = {legalName:'Synthetic Assignment Organization',publicName:'Synthetic Assignment Homes',organizationType:'REAL_ESTATE_AGENCY',publicPhoneOptIn:false};
  const command = () => ({idempotencyKey:randomUUID(),requestId:randomUUID()});
  const org = await lifecycle.create(actors.owner,{...profile,...command()});
  const otherOrg = await lifecycle.create(actors.otherOwner,{...profile,...command()});
  // Role/assignment tests isolate an eligible synthetic principal. Onboarding's
  // real DRAFT principal and its verification/publication gates stay unchanged.
  await client`UPDATE provider_accounts SET state='ACTIVE' WHERE id IN (${org.provider_account_id},${otherOrg.provider_account_id})`;
  const memberships = {owner:org.membership.id,otherOwner:otherOrg.membership.id} as Record<Exclude<typeof names[number],'unrelated'>,string>;
  for (const [name,role,state] of [['admin','ADMIN','ACTIVE'],['manager','LISTING_MANAGER','ACTIVE'],['agent','AGENT','ACTIVE'],['analyst','ANALYST','ACTIVE'],['invited','AGENT','INVITED'],['suspended','AGENT','SUSPENDED'],['revoked','AGENT','REVOKED']] as const) {
    memberships[name] = (await client<{id:string}[]>`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by)
      VALUES(${org.id},${actors[name].userId},${role},${state},${actors.owner.userId}) RETURNING id`)[0]!.id;
  }
  async function listing(providerId:string) {
    const property = (await client<{id:string}[]>`INSERT INTO properties(created_by_user_id,property_type,region,city,neighborhood)
      VALUES(${actors.owner.userId},'APARTMENT','Littoral','Douala','Akwa') RETURNING id`)[0]!.id;
    const relationship = (await client<{id:string}[]>`INSERT INTO provider_property_relationships(property_id,provider_account_id,relationship_type)
      VALUES(${property},${providerId},'AUTHORIZED_AGENT') RETURNING id`)[0]!.id;
    return (await client<{id:string}[]>`INSERT INTO listings(property_id,provider_account_id,provider_property_relationship_id,purpose,created_by_user_id)
      VALUES(${property},${providerId},${relationship},'RENT',${actors.owner.userId}) RETURNING id`)[0]!.id;
  }
  const listingIds = [await listing(org.provider_account_id),await listing(org.provider_account_id)];
  const foreignListingId = await listing(otherOrg.provider_account_id);
  const interactionIds:string[] = [], conversationIds:string[] = [];
  for (const id of listingIds) {
    const interaction = (await client<{id:string}[]>`INSERT INTO interactions(listing_id,seeker_user_id,provider_account_id,state,initial_channel)
      VALUES(${id},${actors.unrelated.userId},${org.provider_account_id},'OPEN','MESSAGE') RETURNING id`)[0]!.id;
    interactionIds.push(interaction);
    conversationIds.push((await client<{id:string}[]>`INSERT INTO conversations(interaction_id) VALUES(${interaction}) RETURNING id`)[0]!.id);
    await client`INSERT INTO interaction_participants(interaction_id,user_id,side) VALUES(${interaction},${actors.agent.userId},'PROVIDER')`;
  }
  const resource = (resourceType:'LISTING'|'INTERACTION',index=0):OrganizationResource => ({organizationId:org.id,resourceType,resourceId:(resourceType==='LISTING'?listingIds:interactionIds)[index]!});
  return {actors,memberships,org,otherOrg,listingIds,foreignListingId,interactionIds,conversationIds,resource,lifecycle,command};
}
