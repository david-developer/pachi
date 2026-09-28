import { verificationProxy } from '../../../../../../lib/verification-proxy';
export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await context.params;
  return verificationProxy(`${encodeURIComponent(id)}/evidence/${encodeURIComponent(kind)}`);
}
