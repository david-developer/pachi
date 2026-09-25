export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export async function csrfValid(request: Request, expected: string | undefined): Promise<boolean> {
  return sameOrigin(request) && Boolean(expected) && request.headers.get('x-csrf-token') === expected;
}
