import { webAuthSession } from './server-auth';
import { forwardOrganizationRequest } from './organization-forward';

export async function organizationProxy(request: Request, path: string, mutation = false, queryKeys: readonly string[] = ['cursor', 'limit']): Promise<Response> {
  const { cookie, auth } = await webAuthSession();
  return forwardOrganizationRequest(request, path, {
    accessToken: auth?.accessToken, csrfToken: cookie.csrfToken
  }, mutation, queryKeys);
}
