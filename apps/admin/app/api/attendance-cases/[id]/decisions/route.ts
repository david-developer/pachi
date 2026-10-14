import { attendanceAdjudicationProxy } from '../../../../../lib/attendance-adjudication-proxy';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return attendanceAdjudicationProxy(`/${encodeURIComponent(id)}/decisions`, request);
}
