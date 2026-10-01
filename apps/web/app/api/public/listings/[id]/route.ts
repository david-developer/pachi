import { NextResponse } from 'next/server';

const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/v1/public/listings/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status, headers: { 'cache-control': 'no-store' } });
}
