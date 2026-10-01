import { listingModerationProxy } from '../../../lib/listing-moderation-proxy';
export async function GET(request: Request) { return listingModerationProxy('', request); }
