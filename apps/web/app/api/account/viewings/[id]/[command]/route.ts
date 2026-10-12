import { viewingProxy } from '@/lib/viewing-bff';

export async function POST(request: Request, context: { params: Promise<{ id: string; command: string }> }): Promise<Response> {
  const { id, command } = await context.params;
  if (!['accept', 'decline', 'confirm', 'cancel'].includes(command))
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return viewingProxy(request, `viewings/${encodeURIComponent(id)}/${command}`, true);
}
