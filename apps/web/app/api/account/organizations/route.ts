import { organizationProxy } from '@/lib/organization-bff';

export async function GET(request: Request): Promise<Response> {
  return organizationProxy(request, 'organizations');
}
export async function POST(request: Request): Promise<Response> {
  return organizationProxy(request, 'organizations', true);
}
