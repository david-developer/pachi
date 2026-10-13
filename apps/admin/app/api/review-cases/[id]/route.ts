import { reviewModerationProxy } from '../../../../lib/review-moderation-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return reviewModerationProxy(`/${encodeURIComponent(id)}${new URL(request.url).search}`, request);
}
