import { reviewProxy } from '@/lib/review-bff';
export async function POST(request: Request, context: { params: Promise<{ id: string; command: string }> }) {
  const { id, command } = await context.params;
  if (!['edit', 'withdraw', 'report'].includes(command)) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return reviewProxy(request, `account/reviews/${encodeURIComponent(id)}/${command}`, true);
}
