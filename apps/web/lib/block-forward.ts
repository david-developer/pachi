import { csrfValid } from './csrf';

/** Fixed server-selected paths; credentials never enter navigation or projections. */
export async function forwardBlockRequest(request:Request,path:string,session:{accessToken?:string|undefined;csrfToken?:string|undefined},mutation=false):Promise<Response> {
  const headers={'cache-control':'private, no-store'};
  if(!session.accessToken)return Response.json({error:'authentication_required'},{status:401,headers});
  if(mutation&&!(await csrfValid(request,session.csrfToken)))return Response.json({error:'csrf_rejected'},{status:403,headers});
  let body:string|undefined;
  if(mutation){try{body=JSON.stringify(await request.json());}catch{return Response.json({error:'invalid_request'},{status:400,headers});}}
  const query=new URLSearchParams();if(!mutation)for(const k of ['cursor','limit']){const v=new URL(request.url).searchParams.get(k);if(v!==null)query.set(k,v);}
  try{
    const response=await fetch(`${process.env.PACHI_API_URL??'http://localhost:3001'}/v1/account/${path}${query.size?`?${query}`:''}`,{
      method:mutation?'POST':'GET',headers:{authorization:`Bearer ${session.accessToken}`,'content-type':'application/json','x-request-id':crypto.randomUUID(),...(mutation?{'idempotency-key':request.headers.get('idempotency-key')??''}:{})},
      ...(body===undefined?{}:{body}),cache:'no-store',signal:AbortSignal.timeout(10_000)
    });
    return Response.json(response.ok?await response.json():{error:response.status===409?'request_conflict':'safety_unavailable'},{status:response.status,headers});
  }catch{return Response.json({error:'safety_unavailable'},{status:503,headers});}
}
