import { listingModerationProxy } from '../../../../../lib/listing-moderation-proxy';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return listingModerationProxy(`/${encodeURIComponent(id)}/decision`, request);
}
