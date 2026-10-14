import { attendanceAdjudicationProxy } from '../../../../lib/attendance-adjudication-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return attendanceAdjudicationProxy(`/${encodeURIComponent(id)}${new URL(request.url).search}`, request);
}
