import { test, expect } from '@playwright/test';
test('unconfigured admin renders safe guidance without credentials or identifiers', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('not configured');
  await expect(page.getByRole('button', { name: 'Sign in with staff account' })).toBeVisible();
});
test('staff summary, denial and logout controls use session API; fixtures do not prove Cognito', async ({
  page,
}) => {
  await page.route('**/api/session', (r) =>
    r.fulfill({
      status: 200,
      json: {
        csrf: 'synthetic-csrf',
        session: {
          display_name: 'Synthetic analyst',
          grants: [
            {
              role: 'ANALYST',
              scope: { kind: 'platform', id: 'pachi', permissions: ['analytics:aggregate'] },
              expires_at: '2026-09-27T00:00:00Z',
            },
          ],
          absolute_expires_at: new Date(Date.now() + 8 * 3600_000).toISOString(),
          idle_expires_at: new Date(Date.now() + 1800_000).toISOString(),
          reauthentication_expires_at: '2026-09-26T12:15:00Z',
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic analyst' })).toBeVisible();
  await expect(
    page.getByText('Sensitive actions require reauthentication', { exact: false }),
  ).toBeVisible();
  await page.route('**/api/auth/logout', async (r) => {
    expect(r.request().method()).toBe('POST');
    expect(r.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    await r.fulfill({ status: 503, json: { error: 'unavailable' } });
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sign-out failed');
  await page.route('**/api/session', (r) =>
    r.fulfill({ status: 403, json: { error: 'ACCESS_DENIED' } }),
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Access denied');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});
test('assigned officer reviews synthetic evidence and records a decision', async ({page}) => {
  await page.route('**/api/session', route => route.fulfill({json:{csrf:'synthetic-csrf',session:{display_name:'Synthetic officer',grants:[{role:'VERIFICATION_OFFICER',scope:{kind:'case',id:'00000000-0000-4000-8000-000000000001',permissions:['provider:verify','evidence:read']},expires_at:new Date(Date.now()+3600_000).toISOString()}],absolute_expires_at:new Date(Date.now()+3600_000).toISOString(),idle_expires_at:new Date(Date.now()+1800_000).toISOString(),reauthentication_expires_at:new Date(Date.now()+900_000).toISOString()}}}));
  await page.route('**/api/verification-cases/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/GOVERNMENT_ID')) return route.fulfill({json:{content:'PACHI_SYNTHETIC_GOVERNMENT_ID_V1'}});
    if(path.endsWith('/LIVE_SELFIE')) return route.fulfill({json:{content:'PACHI_SYNTHETIC_LIVE_SELFIE_V1'}});
    if(path.endsWith('/decision')) {expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');expect(route.request().postDataJSON()).toMatchObject({expected_version:2,outcome:'VERIFIED',reason_code:'EVIDENCE_ACCEPTED'});return route.fulfill({status:201,json:{id:'00000000-0000-4000-8000-000000000001',state:'VERIFIED',version:3,policy_version:'provider-identity-synthetic-v1',reason_code:'EVIDENCE_ACCEPTED',valid_until:new Date(Date.now()+86400_000).toISOString()}});}
    return route.fulfill({json:{id:'00000000-0000-4000-8000-000000000001',state:'PENDING',version:2,policy_version:'provider-identity-synthetic-v1',reason_code:null,valid_until:null}});
  });
  await page.goto('/');
  await page.getByLabel('Case ID').fill('00000000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'Open assigned case'}).click();
  await expect(page.getByText('State: PENDING.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Review government ID sample'}).click();
  await page.getByRole('button',{name:'Review live selfie sample'}).click();
  await page.getByLabel('Decision').selectOption('VERIFIED');
  await page.getByRole('button',{name:'Record decision'}).click();
  await expect(page.getByText('State: VERIFIED.',{exact:false})).toBeVisible();
});
