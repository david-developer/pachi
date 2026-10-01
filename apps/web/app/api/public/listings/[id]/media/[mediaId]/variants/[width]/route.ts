const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function GET(_request: Request, context: { params: Promise<{ id: string; mediaId: string; width: string }> }): Promise<Response> {
  const { id, mediaId, width } = await context.params;
  const response = await fetch(`${apiBase}/v1/public/listings/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}/variants/${encodeURIComponent(width)}`, { cache: 'no-store' });
  return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
