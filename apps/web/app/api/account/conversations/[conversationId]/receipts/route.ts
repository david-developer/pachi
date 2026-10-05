import { conversationProxy } from '@/lib/conversation-bff';
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
): Promise<Response> {
  const { conversationId } = await context.params;
  return conversationProxy(
    request,
    `/${encodeURIComponent(conversationId)}/receipts`,
    true
  );
}
