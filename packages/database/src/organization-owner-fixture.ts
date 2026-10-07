// Synthetic fixtures only; the guarded MFA harness requires NODE_ENV=test and TEST SQL.
import type postgres from 'postgres';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';
import { LocalOrganizationOwnerStepUp } from './organization-owner-step-up.js';
import { OrganizationOwnerStore, type OrganizationOwnershipTransfer } from './organization-owner-lifecycle.js';
import type { OrganizationActor, OrganizationRole } from './organization-lifecycle.js';
export async function organizationOwnerFixture(client: postgres.Sql) {
  const f = await organizationAssignmentFixture(client);
  const stepUp = new LocalOrganizationOwnerStepUp(client);
  for (const [name, actor] of Object.entries(f.actors)) {
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${actor.userId},'https://local.test/assignments',${name},'LOCAL_TEST')`;
    await stepUp.establish(actor, f.org.id);
    await stepUp.establish(actor, f.otherOrg.id);
  }
  const store = new OrganizationOwnerStore(client, stepUp);
  async function context(actor: OrganizationActor) {
    const row = (await client<{version:number;member_version:number}[]>`SELECT o.version,m.version AS member_version FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id
      WHERE o.id=${f.org.id} AND m.user_id=${actor.userId} ORDER BY m.created_at DESC LIMIT 1`)[0];
    return {...f.command(),expectedOrganizationVersion:row?.version??1,expectedActorMembershipVersion:row?.member_version??1};
  }
  async function role(actor: OrganizationActor, target: string, desired: OrganizationRole, use = store) {
    const member = (await client<{version:number}[]>`SELECT version FROM organization_memberships WHERE id=${target}`)[0]!;
    return use.mutateMember(actor,f.org.id,target,{...await context(actor),expectedMembershipVersion:member.version,command:'ROLE',role:desired});
  }
  async function initiate() {
    return store.initiate(f.actors.owner,f.org.id,f.memberships.agent,{...await context(f.actors.owner),expectedRecipientMembershipVersion:1,sourceRoleAfter:'AGENT'});
  }
  async function transferInput(actor: OrganizationActor, transfer: OrganizationOwnershipTransfer, command: 'ACCEPT'|'COMPLETE'|'CANCEL') {
    return {...await context(actor),command,expectedTransferVersion:transfer.version,expectedSourceMembershipVersion:transfer.source_membership_version,expectedRecipientMembershipVersion:transfer.recipient_membership_version};
  }
  return {...f,client,stepUp,store,context,role,initiate,transferInput};
}
