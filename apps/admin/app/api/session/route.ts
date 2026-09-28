import { NextResponse } from 'next/server';
import { StaffAccessError } from '@pachi/database';
import { staffConfig } from '../../../lib/config';
import { staffCookie, staffAccess } from '../../../lib/session';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    staffConfig();
  } catch {
    return NextResponse.json({ error: 'CONFIGURATION' }, { status: 503 });
  }
  const cookie = await staffCookie();
  try {
    if (!cookie.id) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    const token = await staffAccess(cookie.id);
    const response = await fetch(`${staffConfig().api}/v1/staff/session`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: response.status === 403 ? 'ACCESS_DENIED' : 'AUTH_REQUIRED', csrf: cookie.csrf },
        { status: response.status === 403 ? 403 : 401 },
      );
    return NextResponse.json(
      { session: await response.json(), csrf: cookie.csrf },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof StaffAccessError && error.code === 'RESOURCE_SCOPE_DENIED'
            ? 'ACCESS_DENIED'
            : 'AUTH_REQUIRED',
        csrf: cookie.csrf,
      },
      {
        status:
          error instanceof StaffAccessError && error.code === 'RESOURCE_SCOPE_DENIED' ? 403 : 401,
      },
    );
  }
}
