import { organizationProxy } from '@/lib/organization-bff';

type Context = { params: Promise<{ segments: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowed(segments: string[], mutation: boolean): boolean {
  if (!uuid.test(segments[0] ?? '')) return false;
  if (segments[1] === 'resources') {
    if (!['LISTING','INTERACTION'].includes(segments[2] ?? '') || !uuid.test(segments[3] ?? '') || segments[4] !== 'assignments') return false;
    return segments.length === 5 || (mutation && segments.length === 7 && uuid.test(segments[5] ?? '') && segments[6] === 'revoke');
  }
  if (!mutation) return segments.length === 1 ||
    (segments.length === 2 && ['members', 'invitations'].includes(segments[1]!));
  if (segments.length === 2) return segments[1] === 'invitations';
  if (segments.length !== 4 || !uuid.test(segments[2] ?? '')) return false;
  return (segments[1] === 'invitations' && segments[3] === 'revoke') ||
    (segments[1] === 'members' && ['change-role', 'suspend', 'reactivate', 'revoke'].includes(segments[3]!));
}
async function handle(request: Request, context: Context, mutation = false): Promise<Response> {
  const { segments } = await context.params;
  if (!allowed(segments, mutation))
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return organizationProxy(request, `organizations/${segments.map(encodeURIComponent).join('/')}`, mutation,
    segments[1] === 'resources' ? ['cursor','limit','membership_id'] : ['cursor','limit']);
}
export async function GET(request: Request, context: Context): Promise<Response> { return handle(request, context); }
export async function POST(request: Request, context: Context): Promise<Response> { return handle(request, context, true); }
