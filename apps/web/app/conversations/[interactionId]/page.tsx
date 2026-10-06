'use client';
import Link from 'next/link';
import { BlockControls } from '../../components/block-controls';
import { useEffect, useRef, useState } from 'react';
import type {
  InteractionReadResponse,
  MessageListResponse,
  MessageResponse,
  MessageSendResponse,
  ReceiptResponse
} from '@pachi/contracts';

type Session = { authenticated: boolean; csrfToken?: string; userId?: string };
const mergeMessages = (
  previous: MessageResponse[],
  incoming: MessageResponse[]
) =>
  [
    ...new Map(
      [...previous, ...incoming].map((message) => [message.id, message])
    ).values()
  ].sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
const safeFailure = (status: number) =>
  status === 401
    ? 'Sign in again to continue.'
    : status === 403
      ? 'Messaging is not available. You can still view the history.'
      : status === 409
        ? 'This message could not be sent. Refresh the conversation before trying again.'
        : status === 429
          ? 'Too many messages. Wait a minute, then try again.'
          : status === 400
            ? 'Enter a message of 1 to 4,000 characters.'
            : 'The message was not confirmed. Retry to check or send the same message.';

export default function ConversationPage({
  params
}: {
  params: Promise<{ interactionId: string }>;
}) {
  const [interaction, setInteraction] =
    useState<InteractionReadResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [side, setSide] = useState<'SEEKER' | 'PROVIDER'>('SEEKER');
  const [ownBlocked, setOwnBlocked] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState('');
  const [receiptFeedback, setReceiptFeedback] = useState('');
  const pending = useRef<{ client_message_id: string; body: string } | null>(
    null
  );
  const generation = useRef(0);
  const viewEpoch = useRef(0);

  async function loadHistory(context: InteractionReadResponse, older?: string) {
    const current = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/account/conversations/${context.conversation_id}/messages${older ? `?cursor=${encodeURIComponent(older)}` : ''}`,
        { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
      );
      if (current !== generation.current) return;
      if (!response.ok) {
        if ([401, 404].includes(response.status)) {
          setUnavailable(true);
          setMessages([]);
        }
        throw new Error(
          'Conversation history could not be loaded. Refresh to try again.'
        );
      }
      const result = (await response.json()) as MessageListResponse;
      if (current !== generation.current) return;
      setMessages((previous) => mergeMessages(previous, result.items));
      setCursor(result.next_cursor);
      setCanSend(result.can_send);
      setSide(result.actor_side);
      setFeedback(
        result.can_send
          ? ''
          : 'Messaging is not available. You can still view the history.'
      );
    } catch {
      if (current === generation.current)
        setFeedback(
          'Conversation history could not be loaded. Refresh to try again.'
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    viewEpoch.current += 1;
    setInteraction(null);
    setMessages([]);
    setSession(null);
    setCanSend(false);
    setCursor(null);
    setBody('');
    setFeedback('');
    setReceiptFeedback('');
    setUnavailable(false);
    setSending(false);
    pending.current = null;
    setLoading(true);
    void (async () => {
      try {
        const { interactionId } = await params;
        const [response, sessionResponse] = await Promise.all([
          fetch(
            `/api/account/interactions/${encodeURIComponent(interactionId)}`,
            { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
          ),
          fetch('/api/session', {
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000)
          })
        ]);
        if (!response.ok || !sessionResponse.ok) throw new Error();
        const context = (await response.json()) as InteractionReadResponse;
        const actor = (await sessionResponse.json()) as Session;
        if (!active) return;
        setInteraction(context);
        setSession(actor);
        await loadHistory(context);
      } catch {
        if (active) {
          setUnavailable(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      generation.current += 1;
      viewEpoch.current += 1;
    };
  }, [params]);

  // Opening a visible Conversation page is the explicit read UI event.
  // Inbox/background requests never acknowledge reading.
  useEffect(() => {
    if (!interaction || !session?.csrfToken || !session.userId) return;
    let active = true;
    const acknowledge = async () => {
      const state =
        document.visibilityState === 'visible' ? 'READ' : 'DELIVERED';
      const incoming = messages.filter(
        (message) =>
          message.sender_user_id !== session.userId &&
          message.receipts.some(
            (receipt) =>
              receipt.recipient_user_id === session.userId &&
              (state === 'READ' ? !receipt.read_at : !receipt.delivered_at)
          )
      );
      if (!incoming.length) return;
      try {
        const response = await fetch(
          `/api/account/conversations/${interaction.conversation_id}/receipts`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': session.csrfToken!
            },
            body: JSON.stringify({
              message_ids: incoming.slice(0, 50).map((message) => message.id),
              state
            }),
            signal: AbortSignal.timeout(10_000)
          }
        );
        if (!response.ok) throw new Error();
        const result = (await response.json()) as ReceiptResponse;
        if (!active) return;
        setReceiptFeedback('');
        setMessages((previous) =>
          previous.map((message) => ({
            ...message,
            receipts: message.receipts.map((receipt) => {
              const updated = result.receipts.find(
                (row) =>
                  row.message_id === message.id &&
                  row.recipient_user_id === receipt.recipient_user_id
              );
              return updated
                ? {
                    recipient_user_id: updated.recipient_user_id,
                    delivered_at: updated.delivered_at,
                    read_at: updated.read_at
                  }
                : receipt;
            })
          }))
        );
      } catch {
        if (active)
          setReceiptFeedback(
            'Receipt acknowledgement is unavailable. Refresh to try again.'
          );
      }
    };
    void acknowledge();
    const visible = () => {
      if (document.visibilityState === 'visible') void acknowledge();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [interaction, session, side, messages]);

  async function send() {
    if (!interaction || !session?.csrfToken || sending) return;
    if (!body.trim() || Array.from(body).length > 4000) {
      setFeedback(safeFailure(400));
      return;
    }
    const epoch = viewEpoch.current;
    const attempt =
      pending.current?.body === body
        ? pending.current
        : { client_message_id: crypto.randomUUID(), body };
    pending.current = attempt;
    setSending(true);
    setFeedback('Sending…');
    try {
      const response = await fetch(
        `/api/account/conversations/${interaction.conversation_id}/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': session.csrfToken
          },
          body: JSON.stringify(attempt),
          signal: AbortSignal.timeout(10_000)
        }
      );
      if (epoch !== viewEpoch.current) return;
      if (!response.ok) {
        if ([403, 409].includes(response.status)) {
          generation.current += 1;
          setLoading(false);
          setCanSend(false);
        }
        if ([401, 404].includes(response.status)) {
          setUnavailable(true);
          setMessages([]);
        }
        setFeedback(safeFailure(response.status));
        return;
      }
      const result = (await response.json()) as MessageSendResponse;
      if (epoch !== viewEpoch.current) return;
      setMessages((previous) => mergeMessages(previous, [result.message]));
      setBody('');
      pending.current = null;
      setFeedback('Message sent.');
    } catch {
      if (epoch === viewEpoch.current) setFeedback(safeFailure(503));
    } finally {
      if (epoch === viewEpoch.current) setSending(false);
    }
  }
  if (unavailable)
    return (
      <main className="publicShell">
        <h1>That interaction is not available.</h1>
        <Link href="/conversations">Your conversations</Link>
      </main>
    );
  if (!interaction)
    return (
      <main className="publicShell">
        <p role="status">Loading your interaction…</p>
      </main>
    );
  return (
    <main className="publicShell">
      <Link href="/conversations">← Your conversations</Link> ·{' '}
      <Link href="/listings">Browse listings</Link>
      <section className="conversationShell">
        <h1>{interaction.title ?? 'Your listing interaction'}</h1>
        <p className="muted">Interaction state: {interaction.state}</p>
        <BlockControls source="interactions" id={interaction.interaction_id}
          onStart={()=>{generation.current++;setLoading(false);setCanSend(false);}}
          onChange={(blocked)=>{setOwnBlocked(blocked);if(!blocked)void loadHistory(interaction);else setFeedback('Messaging is not available. You can still view the history.');}} />
        <button
          disabled={loading || sending}
          onClick={() => void loadHistory(interaction)}
        >
          Refresh conversation
        </button>
        {loading && <p role="status">Loading messages…</p>}
        {cursor && (
          <button
            disabled={loading || sending}
            onClick={() => void loadHistory(interaction, cursor)}
          >
            Load older messages
          </button>
        )}
        <ol aria-label="Messages">
          {messages.map((message) => (
            <li key={message.id} data-message-id={message.id}>
              <p>
                {message.sender_user_id === session?.userId
                  ? 'You'
                  : message.sender_side === 'PROVIDER'
                    ? 'Provider'
                    : 'Seeker'}{' '}
                · {new Date(message.sent_at).toLocaleString()}
              </p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {message.body ?? 'Message unavailable'}
              </p>
              {message.sender_user_id === session?.userId && (
                <small>
                  {message.receipts.length &&
                  message.receipts.every((r) => r.read_at)
                    ? 'Read'
                    : message.receipts.length &&
                        message.receipts.every((r) => r.delivered_at)
                      ? 'Delivered'
                      : 'Sent'}
                </small>
              )}
            </li>
          ))}
        </ol>
        {!ownBlocked && canSend && interaction.state === 'OPEN' && session?.authenticated && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="message-body">Message</label>
            <textarea
              id="message-body"
              value={body}
              disabled={sending}
              onChange={(event) => setBody(event.target.value)}
            />
            <p>{Array.from(body).length} / 4,000 characters</p>
            <button
              type="submit"
              disabled={
                sending ||
                loading ||
                !body.trim() ||
                Array.from(body).length > 4000
              }
            >
              {sending ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
        {!canSend && pending.current && <button disabled={sending} onClick={()=>void send()}>Confirm pending message</button>}
        {feedback && <p role="status">{feedback}</p>}
        {receiptFeedback && <p role="status">{receiptFeedback}</p>}
      </section>
    </main>
  );
}
