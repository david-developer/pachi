import { NextResponse } from 'next/server';

const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const response = await fetch(`${apiBase}/v1/public/listings${url.search}`, { cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status, headers: { 'cache-control': 'no-store' } });
}
