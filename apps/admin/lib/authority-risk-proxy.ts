import { NextResponse } from 'next/server';
import { staffAccess, staffCookie, validCsrf } from './session';
import { staffConfig } from './config';
export async function authorityRiskProxy(path: string, request: Request): Promise<Response> {
  const cookie = await staffCookie();
  if (!cookie.id) return NextResponse.json({error:'AUTH_REQUIRED'},{status:401});
  if (request.method==='POST' && !validCsrf(request,cookie.csrf)) return NextResponse.json({error:'CSRF_REJECTED'},{status:403});
  try {
    const token = await staffAccess(cookie.id);
    const response = await fetch(`${staffConfig().api}/v1/staff/authority-risk-cases${path}`,{
      method:request.method,
      headers:{authorization:`Bearer ${token}`,...(request.method==='POST'?{'content-type':'application/json'}:{})},
      ...(request.method==='POST'?{body:await request.text()}:{}),cache:'no-store',signal:AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{'cache-control':'no-store'}});
  } catch { return NextResponse.json({error:'AUTH_REQUIRED'},{status:401}); }
}
