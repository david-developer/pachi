import { organizationProxy } from "@/lib/organization-bff";
type Context = { params: Promise<{ listingId: string; command?: string[] }> };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function handle(
  request: Request,
  context: Context,
  mutation: boolean,
): Promise<Response> {
  const { listingId: id, command = [] } = await context.params;
  if (
    !uuid.test(id) ||
    (!mutation && command.length !== 0) ||
    (mutation &&
      (command.length !== 1 || !["market", "freshness"].includes(command[0]!)))
  )
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  return organizationProxy(
    request,
    `listings/${id}/lifecycle${mutation ? `/${command[0]}` : ""}`,
    mutation,
    [],
  );
}
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  return handle(request, context, false);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  return handle(request, context, true);
}
