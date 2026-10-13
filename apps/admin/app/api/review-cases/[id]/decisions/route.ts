import { reviewModerationProxy } from '../../../../../lib/review-moderation-proxy';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return reviewModerationProxy(`/${encodeURIComponent(id)}/decisions`, request);
}
