import { reviewModerationProxy } from '../../../lib/review-moderation-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return reviewModerationProxy(new URL(request.url).search, request);
}
