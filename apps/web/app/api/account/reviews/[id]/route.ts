import { reviewProxy } from '@/lib/review-bff';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return reviewProxy(request, `account/reviews/${encodeURIComponent(id)}`);
}
