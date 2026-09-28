import { listingPhotoProxy } from '../../../../../lib/listing-photo-proxy';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return listingPhotoProxy(`/${encodeURIComponent(id)}/decision`, request);
}
