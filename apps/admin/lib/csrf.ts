export function sameStaffOrigin(request: Request, origin: string): boolean {
  return request.headers.get('origin') === origin && new URL(request.url).origin === origin;
}
export function staffCsrfValid(
  request: Request,
  origin: string,
  expected: string | undefined,
): boolean {
  return (
    sameStaffOrigin(request, origin) &&
    Boolean(expected) &&
    request.headers.get('x-csrf-token') === expected
  );
}
