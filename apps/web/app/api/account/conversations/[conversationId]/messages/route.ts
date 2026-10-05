import { conversationProxy } from '@/lib/conversation-bff';
type Context = { params: Promise<{ conversationId: string }> };
export async function GET(
  request: Request,
  context: Context
): Promise<Response> {
  const { conversationId } = await context.params;
  return conversationProxy(
    request,
    `/${encodeURIComponent(conversationId)}/messages`
  );
}
export async function POST(
  request: Request,
  context: Context
): Promise<Response> {
  const { conversationId } = await context.params;
  return conversationProxy(
    request,
    `/${encodeURIComponent(conversationId)}/messages`,
    true
  );
}
