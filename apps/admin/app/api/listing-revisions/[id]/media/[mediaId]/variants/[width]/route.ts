import { listingModerationProxy } from '../../../../../../../../lib/listing-moderation-proxy';
export async function GET(request: Request, context: { params: Promise<{ id: string; mediaId: string; width: string }> }) {
  const { id, mediaId, width } = await context.params;
  return listingModerationProxy(`/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}/variants/${encodeURIComponent(width)}`, request);
}
