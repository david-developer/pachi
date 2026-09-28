import { NextResponse } from 'next/server';
import { webAuthSession } from '@/lib/server-auth';

const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { auth } = await webAuthSession();
  if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/v1/account/listing-drafts/${id}/readiness`, { headers: { authorization: `Bearer ${auth.accessToken}` }, cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
