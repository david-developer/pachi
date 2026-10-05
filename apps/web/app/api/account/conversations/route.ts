import { conversationProxy } from '@/lib/conversation-bff';
export async function GET(request: Request): Promise<Response> {
  return conversationProxy(request, '');
}
