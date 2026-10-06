import { webAuthSession } from './server-auth';
import { forwardBlockRequest } from './block-forward';
export async function blockProxy(request:Request,path:string,mutation=false):Promise<Response> {
  const {cookie,auth}=await webAuthSession();return forwardBlockRequest(request,path,{accessToken:auth?.accessToken,csrfToken:cookie.csrfToken},mutation);
}
