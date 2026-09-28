import { NextResponse } from 'next/server';
import { csrfValid } from '@/lib/csrf';
import { webAuthSession } from '@/lib/server-auth';
const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET() { const { auth } = await webAuthSession(); if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 }); const response = await fetch(`${apiBase}/v1/account/properties`, { headers: { authorization: `Bearer ${auth.accessToken}` }, cache: 'no-store' }); return NextResponse.json(await response.json(), { status: response.status }); }
export async function POST(request: Request) { const { cookie, auth } = await webAuthSession(); if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 }); if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 }); const response = await fetch(`${apiBase}/v1/account/properties`, { method: 'POST', headers: { authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(await request.json()) }); return NextResponse.json(await response.json(), { status: response.status }); }
