import { listingPhotoProxy } from '../../../lib/listing-photo-proxy';
export async function GET(request: Request) { return listingPhotoProxy('', request); }
