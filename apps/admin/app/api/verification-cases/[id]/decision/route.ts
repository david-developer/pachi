import { verificationProxy } from '../../../../../lib/verification-proxy';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return verificationProxy(`${encodeURIComponent(id)}/decision`,request);
}
