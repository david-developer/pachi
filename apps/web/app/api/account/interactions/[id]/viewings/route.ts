import { viewingProxy } from '@/lib/viewing-bff';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return viewingProxy(request, `interactions/${encodeURIComponent(id)}/viewings`, true);
}
