import { verificationProxy } from '../../../../lib/verification-proxy';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return verificationProxy(encodeURIComponent(id));
}
