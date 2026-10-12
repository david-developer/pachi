import { viewingProxy } from '@/lib/viewing-bff';
export async function POST(request: Request, context: { params: Promise<{ id: string; claimId: string; command: string }> }) {
  const { id, claimId, command } = await context.params;
  if (!['confirm', 'dispute'].includes(command)) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return viewingProxy(request, `viewings/${encodeURIComponent(id)}/attendance/claims/${encodeURIComponent(claimId)}/${command}`, true);
}
