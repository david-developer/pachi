'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Interaction = { interaction_id: string; conversation_id: string; listing_id: string; state: 'OPEN' | 'CLOSED' | 'RESTRICTED'; opened_at: string; title: string | null; listing_visible: boolean };

export default function ConversationShellPage({ params }: { params: Promise<{ interactionId: string }> }) {
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  useEffect(() => { void params.then(({ interactionId }) => fetch(`/api/account/interactions/${encodeURIComponent(interactionId)}`, { cache:'no-store' }).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Interaction>; }).then((value) => { setInteraction(value); setState('ready'); }).catch(() => setState('denied'))); }, [params]);
  if (state === 'loading') return <main className="publicShell"><p className="publicState">Loading your interaction…</p></main>;
  if (state === 'denied' || !interaction) return <main className="publicShell"><section className="emptyResults"><h1>That interaction is not available.</h1><Link className="backLink" href="/listings">Browse listings</Link></section></main>;
  return <main className="publicShell"><Link className="backLink" href="/listings">← Browse listings</Link><section className="conversationShell"><p className="eyebrow">PACHI / CONTACT</p><h1>{interaction.listing_visible && interaction.title ? interaction.title : 'Your listing interaction'}</h1><p className="muted">Interaction state: {interaction.state}. Your contact context is reserved for this listing and provider.</p><div className="conversationNotice"><h2>Conversation opened</h2><p>Messaging is not enabled in this slice yet. Your interaction has been safely recorded and will be available when messaging is introduced.</p></div></section></main>;
}
