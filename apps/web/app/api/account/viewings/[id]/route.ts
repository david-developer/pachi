import { viewingProxy } from '@/lib/viewing-bff';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return viewingProxy(request, `viewings/${encodeURIComponent(id)}`);
}
