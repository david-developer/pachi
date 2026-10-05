import { organizationProxy } from '@/lib/organization-bff';

export async function GET(request: Request): Promise<Response> {
  return organizationProxy(request, 'organization-invitations');
}
