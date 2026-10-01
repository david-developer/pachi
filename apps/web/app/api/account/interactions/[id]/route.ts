import { NextResponse } from 'next/server';
import { webAuthSession } from '@/lib/server-auth';
const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const { auth } = await webAuthSession();
  if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const response = await fetch(`${apiBase}/v1/account/interactions/${encodeURIComponent(id)}`, { headers:{ authorization:`Bearer ${auth.accessToken}` }, cache:'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
