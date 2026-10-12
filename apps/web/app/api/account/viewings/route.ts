import { viewingProxy } from '@/lib/viewing-bff';

export async function GET(request: Request): Promise<Response> {
  return viewingProxy(request, 'viewings');
}
