import { webAuthSession } from './server-auth';
import { forwardReviewRequest } from './review-forward';

export async function reviewProxy(request: Request, path: string, mutation = false): Promise<Response> {
  try {
    const { cookie, auth } = await webAuthSession();
    return await forwardReviewRequest(request, path, { accessToken: auth?.accessToken, csrfToken: cookie.csrfToken }, mutation);
  } catch { return Response.json({ error: 'review_unavailable' }, { status: 503, headers: { 'cache-control': 'private, no-store' } }); }
}
