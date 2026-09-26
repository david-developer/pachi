import { NextResponse } from 'next/server';
import { csrfValid } from '@/lib/csrf';
import { webAuthSession } from '@/lib/server-auth';
const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';
type RouteContext = { params: Promise<{ id: string; mediaAssetId: string }> };

export async function DELETE(request: Request, context: RouteContext) { const { cookie, auth } = await webAuthSession(); if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 }); if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 }); const { id, mediaAssetId } = await context.params; const response = await fetch(`${apiBase}/v1/account/listing-drafts/${id}/media/${mediaAssetId}`, { method: 'DELETE', headers: { authorization: `Bearer ${auth.accessToken}` }, cache: 'no-store' }); return NextResponse.json(await response.json(), { status: response.status }); }
