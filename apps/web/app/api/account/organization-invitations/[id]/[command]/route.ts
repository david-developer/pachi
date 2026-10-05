import { organizationProxy } from '@/lib/organization-bff';

type Context = { params: Promise<{ id: string; command: string }> };
export async function POST(request: Request, context: Context): Promise<Response> {
  const { id, command } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !['accept', 'decline'].includes(command))
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return organizationProxy(request, `organization-invitations/${encodeURIComponent(id)}/${command}`, true);
}
