import { attendanceAdjudicationProxy } from '../../../lib/attendance-adjudication-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return attendanceAdjudicationProxy(new URL(request.url).search, request);
}
