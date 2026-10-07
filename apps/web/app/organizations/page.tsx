'use client';

import Link from 'next/link';
import { OwnerControls } from './owner-controls';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  OrganizationSummary, OrganizationMember, OrganizationInvitation,
  OrganizationListResponse, OrganizationMemberListResponse, OrganizationInvitationListResponse
} from '@pachi/contracts';

type OrdinaryRole = 'LISTING_MANAGER' | 'AGENT' | 'ANALYST';
type OrganizationType = 'REAL_ESTATE_AGENCY' | 'PROPERTY_MANAGEMENT_COMPANY' | 'CORPORATE_PROPERTY_OWNER';
type Session = { authenticated: boolean; participationAllowed?: boolean; csrfToken?: string };
const roles: OrdinaryRole[] = ['LISTING_MANAGER', 'AGENT', 'ANALYST'];
const root = '/api/account/organizations';
const invitationRoot = '/api/account/organization-invitations';

class RequestFailure extends Error {
  constructor(readonly status: number, readonly category?: string) { super('organization_request_failed'); }
}
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new RequestFailure(response.status);
  return response.json() as Promise<T>;
}
function feedback(error: unknown): string {
  if (!(error instanceof RequestFailure)) return 'The action could not be confirmed. Refresh before retrying.';
  if (error.category === 'step_up_required') return 'Recent MFA-backed verification is required. Step-up is currently unavailable; no ownership or admin change was made.';
  if (error.category === 'final_owner_protected') return 'The final active owner is protected. Complete an accepted ownership transfer before removing that owner.';
  if (error.category === 'delivery_unavailable') return 'Invitation delivery is unavailable. No invitation was created.';
  if (error.status === 401) return 'Your sign-in session has expired. Sign in again.';
  if (error.status === 403 || error.status === 404) return 'This action is no longer available to your account. Refresh your organizations.';
  if (error.status === 409) return 'The request conflicts with the current state. Refresh before trying again; your form entries are kept.';
  if (error.status === 400) return 'Check the form entries and invitation validity before trying again.';
  if (error.status === 429) return 'Too many requests. Wait before trying again.';
  return 'The action could not be confirmed. Refresh before retrying; your form entries are kept.';
}

export default function OrganizationsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [organizationCursor, setOrganizationCursor] = useState<string | null>(null);
  const [ownInvitations, setOwnInvitations] = useState<OrganizationInvitation[]>([]);
  const [ownInvitationCursor, setOwnInvitationCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const selected = useRef('');
  const selectionGeneration = useRef(0);
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [invitationCursor, setInvitationCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [legalName, setLegalName] = useState('');
  const [publicName, setPublicName] = useState('');
  const [organizationType, setOrganizationType] = useState<OrganizationType>('REAL_ESTATE_AGENCY');
  const [phoneOptIn, setPhoneOptIn] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [inviteRole, setInviteRole] = useState<OrdinaryRole>('AGENT');
  const pendingCommands = useRef(new Map<string, string>());
  const confirmedChange = useRef(false);
  const canManage = !!organization && organization.state === 'ACTIVE' &&
    organization.membership.state === 'ACTIVE' && ['OWNER', 'ADMIN'].includes(organization.membership.role);

  function forgetSelected() {
    selected.current = '';
    selectionGeneration.current++;
    setSelectedId(''); setOrganization(null); setMembers([]); setInvitations([]);
    setMemberCursor(null); setInvitationCursor(null); setDetailLoading(false); setRecipientPhone('');
  }
  function handleFailure(issue: unknown) {
    setError(confirmedChange.current
      ? 'The change was confirmed, but current workspace access could not be refreshed. Refresh your organizations.'
      : feedback(issue));
    if (issue instanceof RequestFailure && issue.category !== 'step_up_required' && [401, 403, 404].includes(issue.status)) {
      const inaccessible = selected.current;
      forgetSelected();
      setOrganizations(current => current.filter(item => item.id !== inaccessible));
      if (issue.status === 401) {
        setSession({ authenticated: false }); setOrganizations([]); setOwnInvitations([]);
        pendingCommands.current.clear();
      }
    }
  }
  async function loadOverview() {
    const [list, own] = await Promise.all([
      read<OrganizationListResponse>(root), read<OrganizationInvitationListResponse>(invitationRoot)
    ]);
    setOrganizations(list.organizations); setOrganizationCursor(list.next_cursor);
    setOwnInvitations(own.invitations); setOwnInvitationCursor(own.next_cursor);
  }
  async function selectOrganization(id: string) {
    if (selected.current !== id) setRecipientPhone('');
    selected.current = id;
    const generation = ++selectionGeneration.current;
    setSelectedId(id); setOrganization(null); setMembers([]); setInvitations([]);
    setMemberCursor(null); setInvitationCursor(null); setError(''); setDetailLoading(true);
    try {
      const current = await read<OrganizationSummary>(`${root}/${id}`);
      const managed = current.state === 'ACTIVE' && current.membership.state === 'ACTIVE' && ['OWNER', 'ADMIN'].includes(current.membership.role);
      const memberList = managed ? await read<OrganizationMemberListResponse>(`${root}/${id}/members`) : null;
      const invites = managed ? await read<OrganizationInvitationListResponse>(`${root}/${id}/invitations`) : null;
      if (selected.current !== id || selectionGeneration.current !== generation) return;
      setOrganization(current); setMembers(memberList?.members ?? []); setMemberCursor(memberList?.next_cursor ?? null);
      setInvitations(invites?.invitations ?? []); setInvitationCursor(invites?.next_cursor ?? null);
    } catch (issue) {
      if (selected.current === id && selectionGeneration.current === generation) handleFailure(issue);
    } finally {
      if (selected.current === id && selectionGeneration.current === generation) setDetailLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void read<Session>('/api/session').then(async current => {
      if (!active) return;
      setSession(current);
      if (current.authenticated && current.participationAllowed) await loadOverview();
    }).catch(issue => { if (active) handleFailure(issue); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; selectionGeneration.current++; pendingCommands.current.clear(); };
  }, []);

  async function mutate<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    if (!session?.authenticated || !session.csrfToken) throw new RequestFailure(401);
    const canonical = JSON.stringify(payload);
    // Store only a digest for retry lookup, including for one-time token input.
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const identity = `${path}:${digest}`;
    let key = pendingCommands.current.get(identity);
    if (!key) { key = crypto.randomUUID(); pendingCommands.current.set(identity, key); }
    const response = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken, 'idempotency-key': key },
      body: canonical, cache: 'no-store', signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) {
      if (response.status < 500) pendingCommands.current.delete(identity);
      throw new RequestFailure(response.status, result.error);
    }
    pendingCommands.current.delete(identity);
    confirmedChange.current = true;
    return result;
  }
  async function perform(label: string, operation: () => Promise<void>) {
    confirmedChange.current = false;
    setBusy(label); setError(''); setNotice('');
    try { await operation(); }
    catch (issue) { handleFailure(issue); }
    finally { confirmedChange.current = false; setBusy(''); }
  }
  async function refresh() {
    await perform('Refreshing', async () => {
      await loadOverview();
      if (selected.current) await selectOrganization(selected.current);
    });
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await perform('Creating organization', async () => {
      const created = await mutate<OrganizationSummary>(root, {
        legal_name: legalName, public_name: publicName, organization_type: organizationType, public_phone_opt_in: phoneOptIn
      });
      setLegalName(''); setPublicName(''); setPhoneOptIn(false);
      setNotice('Organization created with an initial owner. Business verification and publication remain unavailable.');
      await loadOverview(); await selectOrganization(created.id);
    });
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    const current = organization;
    await perform('Creating invitation', async () => {
      await mutate<OrganizationInvitation>(`${root}/${current.id}/invitations`, {
        recipient_phone: recipientPhone, role: inviteRole, expected_version: current.version
      });
      setRecipientPhone('');
      setNotice('Invitation recorded for private delivery. External delivery has not been confirmed; no invitation code is shown here.');
      await loadOverview(); await selectOrganization(current.id);
    });
  }
  async function membershipCommand(member: OrganizationMember, command: string, role?: OrdinaryRole) {
    await perform('Updating member', async () => {
      await mutate<OrganizationMember>(`${root}/${member.organization_id}/members/${member.id}/${command}`, {
        expected_version: member.version, ...(role ? { role } : {})
      });
      setNotice('Member update confirmed.');
      await loadOverview(); await selectOrganization(member.organization_id);
    });
  }
  async function revokeInvitation(invitation: OrganizationInvitation) {
    await perform('Revoking invitation', async () => {
      await mutate<OrganizationInvitation>(`${root}/${invitation.organization_id}/invitations/${invitation.id}/revoke`, { expected_version: invitation.version });
      setNotice('Invitation revoked. Its history is retained.');
      await loadOverview(); await selectOrganization(invitation.organization_id);
    });
  }
  async function respond(invitation: OrganizationInvitation, command: 'accept' | 'decline', token: string) {
    await perform(command === 'accept' ? 'Accepting invitation' : 'Declining invitation', async () => {
      await mutate<OrganizationInvitation>(`${invitationRoot}/${invitation.id}/${command}`, { token, expected_version: invitation.version });
      setNotice(command === 'accept' ? 'Invitation accepted. Current membership will be refreshed.' : 'Invitation declined. A new invitation is required to join.');
      await loadOverview();
      if (command === 'accept') await selectOrganization(invitation.organization_id);
    });
  }
  async function loadMore(collection: 'organizations' | 'own' | 'members' | 'invitations') {
    const id = selected.current;
    const generation = selectionGeneration.current;
    await perform('Loading more', async () => {
      if (collection === 'organizations' && organizationCursor) {
        const next = await read<OrganizationListResponse>(`${root}?cursor=${encodeURIComponent(organizationCursor)}`);
        setOrganizations(current => [...new Map([...current, ...next.organizations].map(item => [item.id, item])).values()]);
        setOrganizationCursor(next.next_cursor);
      } else if (collection === 'own' && ownInvitationCursor) {
        const next = await read<OrganizationInvitationListResponse>(`${invitationRoot}?cursor=${encodeURIComponent(ownInvitationCursor)}`);
        setOwnInvitations(current => [...new Map([...current, ...next.invitations].map(item => [item.id, item])).values()]);
        setOwnInvitationCursor(next.next_cursor);
      } else if (collection === 'members' && memberCursor) {
        const next = await read<OrganizationMemberListResponse>(`${root}/${id}/members?cursor=${encodeURIComponent(memberCursor)}`);
        if (selected.current !== id || selectionGeneration.current !== generation) return;
        setMembers(current => [...new Map([...current, ...next.members].map(item => [item.id, item])).values()]); setMemberCursor(next.next_cursor);
      } else if (collection === 'invitations' && invitationCursor) {
        const next = await read<OrganizationInvitationListResponse>(`${root}/${id}/invitations?cursor=${encodeURIComponent(invitationCursor)}`);
        if (selected.current !== id || selectionGeneration.current !== generation) return;
        setInvitations(current => [...new Map([...current, ...next.invitations].map(item => [item.id, item])).values()]); setInvitationCursor(next.next_cursor);
      }
    });
  }

  return <main className="workspace organizationWorkspace">
    <nav aria-label="Marketplace"><Link href="/">Your account</Link><Link href="/listings">Browse listings</Link><Link href="/organizations" className="active">Organizations</Link></nav>
    <header><p className="eyebrow">PACHI / ORGANIZATIONS</p><h1>Your organizations</h1><p className="muted">Create an organization and manage ordinary members. Business verification, organization publication and organization messaging are unavailable here.</p></header>
    {loading && <p role="status">Loading organizations…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !session?.authenticated && <p><Link href="/api/auth/login?returnTo=/organizations">Sign in to manage organizations</Link></p>}
    {!loading && session?.authenticated && !session.participationAllowed && <p>Confirm your current phone before organization participation. <Link href="/">Return to account</Link></p>}
    {session?.authenticated && session.participationAllowed && <>
      <button type="button" disabled={!!busy || loading} onClick={() => void refresh()}>{busy === 'Refreshing' ? 'Refreshing…' : 'Refresh organizations'}</button>
      <div className="workspaceGrid"><section className="tool" aria-labelledby="create-organization"><h2 id="create-organization">Create organization</h2>
        <form onSubmit={event => void create(event)}><label>Legal organization name<input disabled={!!busy} required minLength={2} maxLength={160} value={legalName} onChange={event => setLegalName(event.target.value)} /></label>
          <label>Public organization name<input disabled={!!busy} required minLength={2} maxLength={120} value={publicName} onChange={event => setPublicName(event.target.value)} /></label>
          <label>Organization type<select disabled={!!busy} value={organizationType} onChange={event => setOrganizationType(event.target.value as OrganizationType)}><option value="REAL_ESTATE_AGENCY">Real estate agency</option><option value="PROPERTY_MANAGEMENT_COMPANY">Property management company</option><option value="CORPORATE_PROPERTY_OWNER">Corporate property owner</option></select></label>
          <label className="organizationCheckbox"><input disabled={!!busy} type="checkbox" checked={phoneOptIn} onChange={event => setPhoneOptIn(event.target.checked)} />Use my current verified phone as the public business contact</label>
          <p className="fineprint">You become the initial owner. Ownership changes and admin delegation require recent MFA-backed verification. Step-up and final-owner recovery remain unavailable here.</p>
          <button className="primary" disabled={!!busy || loading} type="submit">{busy === 'Creating organization' ? 'Creating…' : 'Create organization'}</button>
        </form></section>
        <section className="tool" aria-labelledby="organization-list"><h2 id="organization-list">Available organizations</h2>
          <ul>{organizations.map(item => <li key={item.id}><button type="button" className="draftItem" disabled={!!busy} aria-pressed={selectedId === item.id} onClick={() => void selectOrganization(item.id)}>{item.public_name} · {item.membership.role}</button></li>)}</ul>
          {!loading && !error && !organizations.length && <p>No active organization memberships yet.</p>}
          {organizationCursor && <button disabled={!!busy} type="button" onClick={() => void loadMore('organizations')}>Load more organizations</button>}
        </section></div>
      <section className="tool" aria-labelledby="your-invitations"><h2 id="your-invitations">Your invitations</h2>
        <p>Use the private code provided with your invitation. Codes are never included in this list or in navigation links.</p>
        <ul>{ownInvitations.map(invitation => <li key={invitation.id}><InvitationResponse key={`${invitation.id}:${invitation.version}`} invitation={invitation} busy={!!busy} respond={respond} /></li>)}</ul>
        {!loading && !error && !ownInvitations.length && <p>No invitations available.</p>}
        {ownInvitationCursor && <button disabled={!!busy} type="button" onClick={() => void loadMore('own')}>Load more of your invitations</button>}
      </section>
      {detailLoading && <p role="status">Loading selected organization…</p>}
      {organization && <section className="tool organizationDetail" aria-labelledby="selected-organization"><h2 id="selected-organization">{organization.public_name}</h2>
        <dl><dt>Organization state</dt><dd>{organization.state}</dd><dt>Business verification</dt><dd>{organization.business_verification}</dd><dt>Publication</dt><dd>Unavailable</dd><dt>Your membership</dt><dd>{organization.membership.role} · {organization.membership.state}</dd></dl>
        {organization.public_contact.phone && <p>Opted-in public business phone: {organization.public_contact.phone}</p>}
        <p>Organization activity does not verify the business, its members or property authority. Resource assignments and organization marketplace operations remain unavailable.</p>
        <OwnerControls key={`${organization.id}:${organization.version}:${organization.membership.version}`} organization={organization} members={members} busy={!!busy} execute={async (path, payload) => {
          let result: unknown; await perform('Updating ownership', async () => { result = await mutate(path, payload); setNotice('Sensitive organization change confirmed.'); await loadOverview(); await selectOrganization(organization.id); }); return result;
        }} />
        {canManage && <><h3>Members</h3><ul aria-label="Organization members">{members.map(member => <li key={member.id}><p>Member {member.user_id} · {member.role} · {member.state}</p>{roles.includes(member.role as OrdinaryRole) && ['ACTIVE', 'SUSPENDED'].includes(member.state) && <MemberControls key={`${member.id}:${member.version}`} member={member} busy={!!busy} command={membershipCommand} />}</li>)}</ul></>}
        {memberCursor && <button disabled={!!busy} type="button" onClick={() => void loadMore('members')}>Load more members</button>}
        {canManage && <><h3>Invite an ordinary member</h3><p>External invitation delivery is unavailable here. Invitations require private delivery to be enabled; no code is displayed to the manager.</p>
          <form aria-label="Invite member" onSubmit={event => void invite(event)}><label>Recipient verified phone<input disabled={!!busy} type="tel" autoComplete="off" required value={recipientPhone} onChange={event => setRecipientPhone(event.target.value)} placeholder="+237…" /></label><label>Invitation role<select disabled={!!busy} value={inviteRole} onChange={event => setInviteRole(event.target.value as OrdinaryRole)}>{roles.map(role => <option key={role} value={role}>{role}</option>)}</select></label><button disabled={!!busy} type="submit">{busy === 'Creating invitation' ? 'Creating invitation…' : 'Create ordinary invitation'}</button></form>
          <h3>Organization invitations</h3><ul aria-label="Organization invitations">{invitations.map(invitation => <li key={invitation.id}><p>{invitation.role} · {invitation.state} · Expires {new Date(invitation.expires_at).toLocaleString()}</p>{invitation.state === 'INVITED' && <button disabled={!!busy} type="button" onClick={() => void revokeInvitation(invitation)}>Revoke invitation</button>}</li>)}</ul>
          {invitationCursor && <button disabled={!!busy} type="button" onClick={() => void loadMore('invitations')}>Load more organization invitations</button>}
        </>}
      </section>}
    </>}
  </main>;
}

function MemberControls({ member, busy, command }: {
  member: OrganizationMember; busy: boolean;
  command: (member: OrganizationMember, command: string, role?: OrdinaryRole) => Promise<void>
}) {
  const [role, setRole] = useState(member.role as OrdinaryRole);
  return <div className="organizationActions"><label>Role for {member.user_id}<select disabled={busy} value={role} onChange={event => setRole(event.target.value as OrdinaryRole)}>{roles.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <button disabled={busy || role === member.role} type="button" onClick={() => void command(member, 'change-role', role)}>Change ordinary role</button>
    <button disabled={busy} type="button" onClick={() => void command(member, member.state === 'ACTIVE' ? 'suspend' : 'reactivate')}>{member.state === 'ACTIVE' ? 'Suspend member' : 'Reactivate member'}</button>
    <button disabled={busy} type="button" onClick={() => void command(member, 'revoke')}>Revoke member</button>
  </div>;
}
function InvitationResponse({ invitation, busy, respond }: {
  invitation: OrganizationInvitation; busy: boolean;
  respond: (invitation: OrganizationInvitation, command: 'accept' | 'decline', token: string) => Promise<void>
}) {
  const [token, setToken] = useState('');
  async function act(command: 'accept' | 'decline') {
    const privateToken = token;
    setToken('');
    try { await respond(invitation, command, privateToken); }
    finally { setToken(''); }
  }
  return <div><p>{invitation.organization_public_name} · {invitation.role} · {invitation.state} · Expires {new Date(invitation.expires_at).toLocaleString()}</p>
    {invitation.state === 'INVITED' && invitation.can_respond && <form onSubmit={event => { event.preventDefault(); void act('accept'); }}><label>Private invitation code<input type="password" autoComplete="off" required value={token} disabled={busy} onChange={event => setToken(event.target.value)} /></label><div className="organizationActions"><button type="submit" disabled={busy || !token}>Accept invitation</button><button type="button" disabled={busy || !token} onClick={() => void act('decline')}>Decline invitation</button></div></form>}
  </div>;
}
