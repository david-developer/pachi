import { reviewProxy } from '@/lib/review-bff';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return reviewProxy(request, `account/review-eligibilities/${encodeURIComponent(id)}/submit`, true);
}
