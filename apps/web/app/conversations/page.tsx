'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  ConversationListResponse,
  ConversationSummary
} from '@pachi/contracts';

export default function ConversationsPage() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function load(after?: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/account/conversations${after ? `?cursor=${encodeURIComponent(after)}` : ''}`,
        { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
      );
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Sign in to view your conversations.'
            : 'Conversations could not be loaded. Try again.'
        );
      const result = (await response.json()) as ConversationListResponse;
      setItems((previous) =>
        after
          ? [
              ...new Map(
                [...previous, ...result.items].map((item) => [
                  item.conversation_id,
                  item
                ])
              ).values()
            ]
          : result.items
      );
      setCursor(result.next_cursor);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Conversations could not be loaded. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="publicShell">
      <Link href="/listings">Browse listings</Link>
      <h1>Your conversations</h1>
      <button disabled={busy} onClick={() => void load()}>
        Refresh conversations
      </button>
      {busy && <p role="status">Loading conversations…</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.conversation_id}>
            <Link href={`/conversations/${item.interaction_id}`}>
              {item.title ?? 'Listing conversation'}
            </Link>
            <p>
              {item.state} · Opened {new Date(item.opened_at).toLocaleString()}
              {item.latest_message_at
                ? ` · Latest message ${new Date(item.latest_message_at).toLocaleString()}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
      {!busy && !error && !items.length && <p>No conversations yet.</p>}
      {cursor && (
        <button disabled={busy} onClick={() => void load(cursor)}>
          Load more conversations
        </button>
      )}
    </main>
  );
}
