import { listingPhotoProxy } from '../../../../../../lib/listing-photo-proxy';
export async function GET(request: Request, context: { params: Promise<{ id: string; width: string }> }) {
  const { id, width } = await context.params;
  return listingPhotoProxy(`/${encodeURIComponent(id)}/variants/${encodeURIComponent(width)}`, request);
}
