import { webAuthSession } from './server-auth';
import { forwardViewingRequest } from './viewing-forward';

export async function viewingProxy(request: Request, path: string, mutation = false): Promise<Response> {
  try {
    const { cookie, auth } = await webAuthSession();
    return await forwardViewingRequest(request, path, { accessToken: auth?.accessToken, csrfToken: cookie.csrfToken }, mutation);
  } catch {
    return Response.json({ error: 'viewing_unavailable' }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
}
