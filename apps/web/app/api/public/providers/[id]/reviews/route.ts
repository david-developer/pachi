import { forwardReviewRequest } from '@/lib/review-forward';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return forwardReviewRequest(request, `providers/${encodeURIComponent(id)}/reviews`, {});
}
