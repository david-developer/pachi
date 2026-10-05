import { test, expect, type Page } from '@playwright/test';
import type { MessageResponse } from '@pachi/contracts';

const ids = {
  listing: '00000000-0000-4000-8000-000000000071',
  interaction: '00000000-0000-4000-8000-000000000072',
  conversation: '00000000-0000-4000-8000-000000000073',
  seeker: '00000000-0000-4000-8000-000000000074',
  provider: '00000000-0000-4000-8000-000000000075'
};
const context = {
  interaction_id: ids.interaction,
  conversation_id: ids.conversation,
  listing_id: ids.listing,
  state: 'OPEN',
  opened_at: '2026-10-05T00:00:00.000Z',
  title: 'Synthetic messaging flat',
  listing_visible: true,
  created: false
};
function message(
  body: string,
  side: 'SEEKER' | 'PROVIDER',
  sequence = 1
): MessageResponse {
  return {
    id: `00000000-0000-4000-8000-${String(sequence + 100).padStart(12, '0')}`,
    conversation_id: ids.conversation,
    sender_user_id: side === 'SEEKER' ? ids.seeker : ids.provider,
    sender_side: side,
    client_message_id: `00000000-0000-4000-8000-${String(sequence + 200).padStart(12, '0')}`,
    body,
    sequence: String(sequence),
    sent_at: '2026-10-05T00:00:01.000Z',
    visibility_state: 'VISIBLE',
    receipts: [
      {
        recipient_user_id: side === 'SEEKER' ? ids.provider : ids.seeker,
        delivered_at: null,
        read_at: null
      }
    ]
  };
}
async function fixture(
  page: Page,
  options: {
    state?: string;
    canSend?: boolean;
    messages?: MessageResponse[];
    side?: 'SEEKER' | 'PROVIDER';
  } = {}
) {
  const state = {
    side: options.side ?? 'SEEKER',
    messages: options.messages ?? [],
    canSend: options.canSend ?? true,
    interactionState: options.state ?? 'OPEN',
    receiptCalls: [] as { state: string; message_ids: string[] }[],
    sendCalls: [] as { client_message_id: string; body: string }[]
  };
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        userId: state.side === 'SEEKER' ? ids.seeker : ids.provider,
        participationAllowed: true,
        csrfToken: 'synthetic-csrf'
      }
    })
  );
  await page.route('**/api/account/interactions/*', (route) =>
    route.fulfill({ json: { ...context, state: state.interactionState } })
  );
  await page.route('**/api/account/conversations', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...context,
            state: state.interactionState,
            latest_message_at: state.messages.at(-1)?.sent_at ?? null
          }
        ],
        next_cursor: null
      }
    })
  );
  await page.route('**/api/account/conversations/*/messages*', (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as {
        client_message_id: string;
        body: string;
      };
      state.sendCalls.push(input);
      const previous = state.messages.find(
        (m) =>
          m.sender_side === state.side &&
          m.client_message_id === input.client_message_id
      );
      const persisted = previous ?? {
        ...message(input.body, state.side, state.messages.length + 1),
        client_message_id: input.client_message_id
      };
      if (!previous) state.messages.push(persisted);
      return route.fulfill({
        status: 201,
        json: { message: persisted, created: !previous }
      });
    }
    return route.fulfill({
      json: {
        items: [...state.messages].reverse(),
        next_cursor: null,
        can_send: state.canSend && state.interactionState === 'OPEN',
        actor_side: state.side
      }
    });
  });
  await page.route('**/api/account/conversations/*/receipts', (route) => {
    const input = route.request().postDataJSON() as {
      state: string;
      message_ids: string[];
    };
    state.receiptCalls.push(input);
    const recipient = state.side === 'SEEKER' ? ids.seeker : ids.provider;
    const receipts = state.messages
      .filter((m) => input.message_ids.includes(m.id))
      .flatMap((m) =>
        m.receipts
          .filter((r) => r.recipient_user_id === recipient)
          .map((r) => {
            r.delivered_at ??= '2026-10-05T00:00:02.000Z';
            if (input.state === 'READ')
              r.read_at ??= '2026-10-05T00:00:03.000Z';
            return { ...r, message_id: m.id };
          })
      );
    return route.fulfill({ status: 201, json: { receipts } });
  });
  return state;
}

test('eligible seeker enters inquiry, sends persisted text, and sees no private provider contacts', async ({
  page
}) => {
  const state = await fixture(page);
  const listing = {
    id: ids.listing,
    purpose: 'RENT',
    title: context.title,
    description: 'Synthetic listing',
    price: {
      amount_minor: 200000,
      currency: 'XAF',
      pricing_period: 'MONTHLY',
      negotiable: false
    },
    terms: {},
    property: { property_type: 'APARTMENT', bedrooms: 2, bathrooms: 1 },
    location: { region: 'Littoral', city: 'Douala', neighborhood: 'Akwa' },
    market_status: 'AVAILABLE',
    available_from: '2026-10-01',
    expires_at: '2026-11-01T00:00:00.000Z',
    media: []
  };
  await page.route('**/api/public/listings/**', (route) =>
    route.fulfill({ json: listing })
  );
  await page.route('**/api/account/listings/*/inquiry', (route) =>
    route.fulfill({ status: 201, json: { ...context, created: true } })
  );
  await page.goto(`/listings/${ids.listing}`);
  await page.getByRole('button', { name: 'Contact provider' }).click();
  await expect(page).toHaveURL(`/conversations/${ids.interaction}`);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Is this flat available?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('Is this flat available?', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Message sent.', { exact: true })).toBeVisible();
  expect(state.messages).toHaveLength(1);
  expect(state.sendCalls[0]!.client_message_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await page.locator('body').innerText()).not.toMatch(
    /\+237\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|PRIVATE_ADDRESS/i
  );
});

test('Conversation renders hostile-looking text literally without executing scripts or linkifying URLs', async ({
  page
}) => {
  const text =
    '<script>window.messageScriptExecuted=true</script> https://untrusted.invalid/';
  await fixture(page, { messages: [message(text, 'PROVIDER')] });
  await page.goto(`/conversations/${ids.interaction}`);
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'messageScriptExecuted' in window)).toBe(
    false
  );
  expect(
    await page.locator('a[href="https://untrusted.invalid/"]').count()
  ).toBe(0);
});

test('provider inbox finds Conversation, persists reply and seeker subsequently reads it', async ({
  page
}) => {
  const state = await fixture(page, {
    side: 'PROVIDER',
    messages: [message('Seeker inquiry', 'SEEKER')]
  });
  await page.goto('/conversations');
  await page.getByRole('link', { name: context.title }).click();
  await expect(page.getByText('Seeker inquiry', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Provider durable reply');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('Provider durable reply', { exact: true })
  ).toBeVisible();
  state.side = 'SEEKER';
  await page.goto('/conversations');
  await page.getByRole('link', { name: context.title }).click();
  await expect(
    page.getByText('Provider durable reply', { exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      state.receiptCalls.some(
        (r) =>
          r.state === 'READ' && r.message_ids.includes(state.messages[1]!.id)
      )
    )
    .toBe(true);
});

test('CLOSED/RESTRICTED and unavailable capabilities keep history without an active composer', async ({
  page
}) => {
  const state = await fixture(page, {
    messages: [message('Preserved history', 'PROVIDER')]
  });
  for (const status of ['CLOSED', 'RESTRICTED', 'OPEN']) {
    state.interactionState = status;
    state.canSend = false;
    await page.goto(`/conversations/${ids.interaction}`);
    await expect(
      page.getByText('Preserved history', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText(
        'Messaging is not available. You can still view the history.',
        { exact: true }
      )
    ).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(
      /blocked by|restriction reason|risk_hold/i
    );
  }
});

test('403/409/429 send responses show safe actionable feedback and preserve history', async ({
  page
}) => {
  await fixture(page, {
    messages: [message('History survives denial', 'PROVIDER')]
  });
  let status = 403;
  await page.route('**/api/account/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status,
      json: { message: 'INTERNAL_SENTINEL_MUST_NOT_RENDER' }
    });
  });
  for (const code of [403, 409, 429]) {
    status = code;
    await page.goto(`/conversations/${ids.interaction}`);
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Attempt');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    const text =
      code === 403
        ? 'Messaging is not available. You can still view the history.'
        : code === 409
          ? 'This message could not be sent. Refresh the conversation before trying again.'
          : 'Too many messages. Wait a minute, then try again.';
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(
      page.getByText('History survives denial', { exact: true })
    ).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(
      'INTERNAL_SENTINEL'
    );
    if (code === 429)
      await expect(
        page.getByRole('textbox', { name: 'Message', exact: true })
      ).toHaveValue('Attempt');
    else
      await expect(
        page.getByRole('textbox', { name: 'Message', exact: true })
      ).toHaveCount(0);
  }
});

test('ambiguous send response retries the same client ID without duplicate visible messages', async ({
  page
}) => {
  const state = await fixture(page);
  let first = true;
  let original: { client_message_id: string; body: string } | null = null;
  await page.route('**/api/account/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = route.request().postDataJSON() as {
      client_message_id: string;
      body: string;
    };
    if (first) {
      first = false;
      original = input;
      state.messages.push({
        ...message(input.body, 'SEEKER'),
        client_message_id: input.client_message_id
      });
      return route.abort('failed');
    }
    expect(input).toEqual(original);
    return route.fulfill({
      status: 201,
      json: { message: state.messages[0], created: false }
    });
  });
  await page.goto(`/conversations/${ids.interaction}`);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('One durable attempt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText(/The message was not confirmed/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh conversation', exact: true })
    .click();
  await expect(
    page
      .getByRole('list', { name: 'Messages' })
      .getByText('One durable attempt', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Message sent.', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Messages' })
      .getByText('One durable attempt', { exact: true })
  ).toHaveCount(1);
  expect(state.messages).toHaveLength(1);
});

test('load older preserves ordered messages and read acknowledgement requires a visible Conversation page', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', {
      get: () =>
        (window as unknown as Record<string, boolean>).conversationVisible
          ? 'visible'
          : 'hidden',
      configurable: true
    });
  });
  const state = await fixture(page, {
    messages: [
      message('Older message', 'PROVIDER', 1),
      message('Newer message', 'PROVIDER', 2)
    ]
  });
  await page.route('**/api/account/conversations/*/messages*', (route) =>
    route.fulfill({
      json: {
        items: new URL(route.request().url()).searchParams.has('cursor')
          ? [state.messages[0]]
          : [state.messages[1]],
        next_cursor: new URL(route.request().url()).searchParams.has('cursor')
          ? null
          : '2',
        can_send: true,
        actor_side: 'SEEKER'
      }
    })
  );
  await page.goto('/conversations');
  await expect(page.getByRole('link', { name: context.title })).toBeVisible();
  expect(state.receiptCalls).toHaveLength(0);
  await page.getByRole('link', { name: context.title }).click();
  await expect(page.getByText('Newer message', { exact: true })).toBeVisible();
  await expect
    .poll(() => state.receiptCalls.some((r) => r.state === 'DELIVERED'))
    .toBe(true);
  expect(state.receiptCalls.some((r) => r.state === 'READ')).toBe(false);
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.getByText('Older message', { exact: true })).toBeVisible();
  await expect(page.locator('ol[aria-label="Messages"] > li')).toHaveCount(2);
  await page.evaluate(() => {
    (window as unknown as Record<string, boolean>).conversationVisible = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => state.receiptCalls.some((r) => r.state === 'READ'))
    .toBe(true);
  const texts = await page
    .locator('ol[aria-label="Messages"] > li')
    .allTextContents();
  expect(texts[0]).toContain('Older message');
  expect(texts[1]).toContain('Newer message');
});
