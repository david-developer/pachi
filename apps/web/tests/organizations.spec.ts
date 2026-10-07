import { expect, test, type Page, type Route } from '@playwright/test';
import type { OrganizationInvitation, OrganizationMember, OrganizationSummary } from '@pachi/contracts';

const ids = {
  organization: '00000000-0000-4000-8000-000000000401',
  other: '00000000-0000-4000-8000-000000000402',
  owner: '00000000-0000-4000-8000-000000000403',
  member: '00000000-0000-4000-8000-000000000404',
  user: '00000000-0000-4000-8000-000000000405',
  invitation: '00000000-0000-4000-8000-000000000406',
  provider: '00000000-0000-4000-8000-000000000407'
};
const root = '/api/account/organizations';
const ownRoot = '/api/account/organization-invitations';
const token = 'SYNTHETIC_PRIVATE_INVITATION_CODE';
function organization(id = ids.organization, role: OrganizationSummary['membership']['role'] = 'OWNER'): OrganizationSummary {
  return {
    id, public_name: id === ids.organization ? 'Synthetic agency' : 'Other synthetic agency',
    organization_type: 'REAL_ESTATE_AGENCY', state: 'ACTIVE', version: 1,
    provider_account_id: ids.provider, business_verification: 'NOT_VERIFIED', publication_eligible: false,
    public_contact: { phone: null }, membership: { id: ids.owner, role, state: 'ACTIVE', version: 1 },
    created_at: '2026-10-05T00:00:00.000Z'
  };
}
function invitation(id = ids.invitation, organizationId = ids.other): OrganizationInvitation {
  return { id, organization_id: organizationId, organization_public_name: organizationId === ids.other ? 'Other synthetic agency' : 'Synthetic agency', role: 'AGENT', state: 'INVITED', version: 1, expires_at: '2026-10-12T00:00:00.000Z', created_at: '2026-10-05T00:00:00.000Z', membership_id: ids.member, can_respond: true };
}
async function workspace(page: Page, options: { empty?: boolean; own?: boolean; second?: boolean } = {}) {
  const state = {
    organizations: options.empty ? [] : [organization(), ...(options.second ? [organization(ids.other)] : [])],
    members: [
      { id: ids.owner, organization_id: ids.organization, user_id: ids.owner, role: 'OWNER', state: 'ACTIVE', version: 1, activated_at: '2026-10-05T00:00:00.000Z', revoked_at: null },
      { id: ids.member, organization_id: ids.organization, user_id: ids.user, role: 'AGENT', state: 'ACTIVE', version: 1, activated_at: '2026-10-05T00:00:00.000Z', revoked_at: null }
    ] as OrganizationMember[],
    invitations: [] as OrganizationInvitation[],
    own: options.own ? [invitation()] : [] as OrganizationInvitation[],
    reads: [] as string[],
    calls: [] as { path: string; key: string; csrf: string; body: Record<string, unknown> }[],
    denied: false,
    failure: null as null | { path: string; status: number; error: string },
    abortAfterCommit: '',
    hold: null as null | { path: string; arrived: () => void; wait: Promise<void> }
  };
  const receipts = new Map<string, unknown>();
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    expect(url.searchParams.has('token')).toBe(false);
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, accountState: 'ACTIVE', participationAllowed: true, csrfToken: 'synthetic-csrf' } });
    if (request.method() === 'GET') {
      state.reads.push(path);
      if (path === root) return route.fulfill({ json: { organizations: state.organizations, next_cursor: null } });
      if (path === ownRoot) return route.fulfill({ json: { invitations: state.own, next_cursor: null } });
      if (state.denied) return route.fulfill({ status: 404, json: { error: 'organization_request_failed' } });
      const id = path.split('/')[4];
      if (path.endsWith('/members')) {
        const current = state.organizations.find(item => item.id === id);
        if (!current || !['OWNER', 'ADMIN'].includes(current.membership.role)) return route.fulfill({ status: 404, json: { error: 'organization_request_failed' } });
        return route.fulfill({ json: { members: state.members.map(member => ({ ...member, organization_id: id })), next_cursor: null } });
      }
      if (path.endsWith('/invitations')) return route.fulfill({ json: { invitations: state.invitations, next_cursor: null } });
      const current = state.organizations.find(item => item.id === id);
      const body = structuredClone(current);
      if (state.hold?.path === path) { const pending = state.hold; state.hold = null; pending.arrived(); await pending.wait; }
      return route.fulfill({ json: body });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const key = request.headers()['idempotency-key'] ?? '';
    state.calls.push({ path, body, key, csrf: request.headers()['x-csrf-token'] ?? '' });
    if (state.failure?.path === path) {
      const failure = state.failure; state.failure = null;
      return route.fulfill({ status: failure.status, json: { error: failure.error } });
    }
    if (receipts.has(key)) return route.fulfill({ status: 201, json: receipts.get(key) });
    let result: unknown;
    if (path === root) {
      const created = { ...organization(), public_name: body.public_name as string };
      state.organizations.push(created); result = created;
    } else if (path === `${root}/${ids.organization}/invitations`) {
      expect(body.expected_version).toBe(state.organizations[0]!.version);
      const created = { ...invitation(ids.invitation, ids.organization), role: body.role as OrganizationInvitation['role'], can_respond: false };
      state.invitations.push(created); state.organizations[0]!.version++; result = created;
    } else if (path.startsWith(`${ownRoot}/`)) {
      expect(body.token).toBe(token);
      const own = state.own[0]!;
      expect(body.expected_version).toBe(own.version);
      own.state = path.endsWith('/accept') ? 'ACTIVE' : 'DECLINED'; own.can_respond = false; own.version++;
      if (own.state === 'ACTIVE') state.organizations.push(organization(ids.other, 'AGENT'));
      result = structuredClone(own);
    } else if (path.includes('/members/')) {
      const member = state.members.find(item => item.id === path.split('/')[6])!;
      expect(body.expected_version).toBe(member.version);
      const command = path.split('/').at(-1);
      if (command === 'change-role') member.role = body.role as OrganizationMember['role'];
      if (command === 'suspend') member.state = 'SUSPENDED';
      if (command === 'reactivate') member.state = 'ACTIVE';
      if (command === 'revoke') { member.state = 'REVOKED'; member.revoked_at = '2026-10-05T00:01:00.000Z'; }
      member.version++; state.organizations[0]!.version++; result = structuredClone(member);
    } else if (path.includes('/invitations/') && path.endsWith('/revoke')) {
      const pending = state.invitations[0]!;
      expect(body.expected_version).toBe(pending.version);
      pending.state = 'REVOKED'; pending.version++; state.organizations[0]!.version++; result = structuredClone(pending);
    } else throw new Error('Unexpected synthetic organization route');
    receipts.set(key, result);
    if (state.abortAfterCommit === path) { state.abortAfterCommit = ''; return route.abort('failed'); }
    return route.fulfill({ status: 201, json: result });
  });
  await page.goto('/organizations');
  await expect(page.getByRole('heading', { name: 'Your organizations', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh organizations', exact: true })).toBeEnabled();
  return state;
}
async function openOrganization(page: Page, name = 'Synthetic agency') {
  await page.getByRole('button', { name: `${name} · OWNER`, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
const memberRow = (page: Page) => page.getByRole('list', { name: 'Organization members', exact: true }).locator('li').filter({ hasText: ids.user });

test('creation waits for the initial overview so an older response cannot hide the new organization', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, participationAllowed: true, csrfToken: 'synthetic-csrf' } });
    if (path === ownRoot) return route.fulfill({ json: { invitations: [], next_cursor: null } });
    if (path === root) {
      await pending;
      return route.fulfill({ json: { organizations: [], next_cursor: null } });
    }
    throw new Error('Unexpected initialization request');
  });
  await page.goto('/organizations');
  await expect(page.getByRole('status').filter({ hasText: 'Loading organizations' })).toBeVisible();
  const create = page.getByRole('button', { name: 'Create organization', exact: true });
  await expect(create).toBeDisabled();
  release();
  await expect(create).toBeEnabled();
});

test('creation establishes owner workspace with distinct business state and separate step-up-protected controls', async ({ page }) => {
  const state = await workspace(page, { empty: true });
  await page.getByLabel('Legal organization name', { exact: true }).fill('Synthetic Legal Agency');
  await page.getByLabel('Public organization name', { exact: true }).fill('Created synthetic agency');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Created synthetic agency', exact: true })).toBeVisible();
  await expect(page.getByText('NOT_VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  expect(state.calls[0]!.csrf).toBe('synthetic-csrf');
  expect(state.calls[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.calls[0]!.body).toEqual({ legal_name: 'Synthetic Legal Agency', public_name: 'Created synthetic agency', organization_type: 'REAL_ESTATE_AGENCY', public_phone_opt_in: false });
  await expect(page.getByRole('button', { name: /recover|publish/i })).toHaveCount(0);
  await expect(page.getByText('Ownership and admin changes require recent MFA-backed verification. Step-up is currently unavailable in this development interface. The server will require it before a change can proceed.')).toBeVisible();
  const privileged = page.getByRole('list', { name: 'Organization members', exact: true }).locator('li').filter({ hasText: ids.owner });
  await expect(privileged.getByRole('button')).toHaveCount(0);
  await expect(privileged.getByRole('combobox')).toHaveCount(0);
});

test('ordinary invitation and revocation show durable state without a code or sent claim', async ({ page }) => {
  const state = await workspace(page);
  await openOrganization(page);
  await page.getByLabel('Recipient verified phone', { exact: true }).fill('+237690000001');
  await page.getByRole('combobox', { name: 'Invitation role', exact: true }).selectOption('LISTING_MANAGER');
  await expect(page.getByRole('combobox', { name: 'Invitation role', exact: true }).locator('option')).toHaveText(['LISTING_MANAGER', 'AGENT', 'ANALYST']);
  await page.getByRole('button', { name: 'Create ordinary invitation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation recorded for private delivery' })).toBeVisible();
  expect(state.invitations).toHaveLength(1);
  await expect(page.getByText(token)).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Organization invitations', exact: true })).toContainText('REVOKED');
  await expect(page.getByRole('button', { name: 'Revoke invitation', exact: true })).toHaveCount(0);
});

test('private invitation acceptance clears token and opens ordinary membership without manager controls', async ({ page }) => {
  const state = await workspace(page, { own: true });
  const code = page.getByLabel('Private invitation code', { exact: true });
  await expect(code).toHaveAttribute('type', 'password');
  await code.fill(token);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other synthetic agency', exact: true })).toBeVisible();
  await expect(code).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create ordinary invitation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Suspend member', exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Organization members', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Other synthetic agency · AGENT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other synthetic agency', exact: true })).toBeVisible();
  expect(state.reads).not.toContain(`${root}/${ids.other}/members`);
  expect(state.reads).not.toContain(`${root}/${ids.other}/invitations`);
  expect(state.calls[0]!.body).toEqual({ token, expected_version: 1 });
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
  expect(page.url()).not.toContain(token);
  await expect(page.getByText(token)).toHaveCount(0);
});

test('declined invitation retains terminal state and no responding controls', async ({ page }) => {
  const state = await workspace(page, { own: true });
  await page.getByLabel('Private invitation code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Decline invitation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation declined' })).toBeVisible();
  expect(state.own[0]!.state).toBe('DECLINED');
  await expect(page.getByLabel('Private invitation code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
});

test('role, suspension, reactivation and revocation use current target versions', async ({ page }) => {
  const state = await workspace(page);
  await openOrganization(page);
  const member = memberRow(page);
  await member.getByRole('combobox').selectOption('ANALYST');
  await member.getByRole('button', { name: 'Change ordinary role', exact: true }).click();
  await expect(member).toContainText('ANALYST · ACTIVE');
  await member.getByRole('button', { name: 'Suspend member', exact: true }).click();
  await expect(member).toContainText('ANALYST · SUSPENDED');
  await member.getByRole('button', { name: 'Reactivate member', exact: true }).click();
  await expect(member).toContainText('ANALYST · ACTIVE');
  await member.getByRole('button', { name: 'Revoke member', exact: true }).click();
  await expect(member).toContainText('ANALYST · REVOKED');
  await expect(member.getByRole('button')).toHaveCount(0);
  expect(state.calls.map(call => call.body.expected_version)).toEqual([1, 2, 3, 4]);
});

test('stale request preserves form and disabled delivery never claims an invitation was sent', async ({ page }) => {
  const state = await workspace(page);
  await openOrganization(page);
  const phone = page.getByLabel('Recipient verified phone', { exact: true });
  await phone.fill('+237690000001');
  state.failure = { path: `${root}/${ids.organization}/invitations`, status: 409, error: 'organization_request_failed' };
  await page.getByRole('button', { name: 'Create ordinary invitation', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('conflicts with the current state');
  await expect(phone).toHaveValue('+237690000001');
  state.failure = { path: `${root}/${ids.organization}/invitations`, status: 503, error: 'delivery_unavailable' };
  await page.getByRole('button', { name: 'Create ordinary invitation', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('No invitation was created');
  expect(state.invitations).toHaveLength(0);
  await expect(page.getByRole('status').filter({ hasText: 'Invitation recorded' })).toHaveCount(0);
});

test('stale invitation refresh preserves recipient and role while updating the expected organization version', async ({ page }) => {
  const state = await workspace(page);
  await openOrganization(page);
  const phone = page.getByLabel('Recipient verified phone', { exact: true });
  const role = page.getByRole('combobox', { name: 'Invitation role', exact: true });
  await phone.fill('+237690000001');
  await role.selectOption('ANALYST');
  state.organizations[0]!.version++;
  state.failure = { path: `${root}/${ids.organization}/invitations`, status: 409, error: 'organization_request_failed' };
  await page.getByRole('button', { name: 'Create ordinary invitation', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('conflicts with the current state');
  await page.getByRole('button', { name: 'Refresh organizations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic agency', exact: true })).toBeVisible();
  await expect(phone).toHaveValue('+237690000001');
  await expect(role).toHaveValue('ANALYST');
  await page.getByRole('button', { name: 'Create ordinary invitation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation recorded for private delivery' })).toBeVisible();
  expect(state.calls.map(call => call.body.expected_version)).toEqual([1, 2]);
  expect(state.invitations).toHaveLength(1);
  expect(state.invitations[0]!.role).toBe('ANALYST');
});

test('ambiguous creation retries the original command without duplicate organization', async ({ page }) => {
  const state = await workspace(page, { empty: true });
  await page.getByLabel('Legal organization name', { exact: true }).fill('Synthetic Legal Agency');
  await page.getByLabel('Public organization name', { exact: true }).fill('Created synthetic agency');
  state.abortAfterCommit = root;
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByLabel('Public organization name', { exact: true })).toHaveValue('Created synthetic agency');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Created synthetic agency', exact: true })).toBeVisible();
  expect(state.organizations).toHaveLength(1);
  expect(state.calls[1]!.key).toBe(state.calls[0]!.key);
});

test('ambiguous invitation acceptance clears secret input and reentry retries its original identity', async ({ page }) => {
  const state = await workspace(page, { own: true });
  state.abortAfterCommit = `${ownRoot}/${ids.invitation}/accept`;
  const code = page.getByLabel('Private invitation code', { exact: true });
  await code.fill(token);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('could not be confirmed');
  await expect(code).toHaveValue('');
  await code.fill(token);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other synthetic agency', exact: true })).toBeVisible();
  expect(state.calls[1]!.key).toBe(state.calls[0]!.key);
  expect(state.organizations.filter(item => item.id === ids.other)).toHaveLength(1);
});

test('access loss clears prior private member workspace immediately on a denied refresh', async ({ page }) => {
  const state = await workspace(page);
  await openOrganization(page);
  await expect(memberRow(page)).toBeVisible();
  state.denied = true;
  await page.getByRole('button', { name: 'Refresh organizations', exact: true }).click();
  await expect(page.locator('.organizationWorkspace').getByRole('alert')).toContainText('no longer available');
  await expect(page.getByRole('heading', { name: 'Synthetic agency', exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Organization members', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create ordinary invitation', exact: true })).toHaveCount(0);
});

test('older organization response cannot replace a newly selected organization', async ({ page }) => {
  const state = await workspace(page, { second: true });
  let arrived!: () => void;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  state.hold = { path: `${root}/${ids.organization}`, arrived, wait: pending };
  await page.getByRole('button', { name: 'Synthetic agency · OWNER', exact: true }).click();
  await started;
  await openOrganization(page, 'Other synthetic agency');
  release();
  await page.waitForTimeout(150);
  await expect(page.getByRole('heading', { name: 'Other synthetic agency', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic agency', exact: true })).toHaveCount(0);
});
