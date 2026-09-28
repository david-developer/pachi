export function staffConfig(env: Record<string, string | undefined> = process.env) {
  const required = [
    'STAFF_COGNITO_ISSUER',
    'STAFF_COGNITO_CLIENT_ID',
    'STAFF_COGNITO_CLIENT_SECRET',
    'STAFF_COGNITO_DOMAIN',
    'STAFF_ORIGIN',
    'STAFF_SESSION_SECRET',
    'DATABASE_URL',
    'PACHI_API_URL',
  ] as const;
  for (const key of required) if (!env[key]) throw new Error('STAFF_CONFIGURATION');
  const issuer = env.STAFF_COGNITO_ISSUER!,
    clientId = env.STAFF_COGNITO_CLIENT_ID!,
    origin = env.STAFF_ORIGIN!;
  const match =
    /^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9-]+_[A-Za-z0-9]+)$/.exec(issuer);
  if (
    !match ||
    !match[2]!.startsWith(`${match[1]}_`) ||
    issuer === env.COGNITO_ISSUER ||
    env.COGNITO_CLIENT_IDS?.split(',').includes(clientId) ||
    clientId === env.COGNITO_CLIENT_ID
  )
    throw new Error('STAFF_CONFIGURATION');
  if (
    new URL(origin).origin !== origin ||
    (new URL(origin).protocol !== 'https:' && origin !== 'http://localhost:3002')
  )
    throw new Error('STAFF_CONFIGURATION');
  if (env.NODE_ENV === 'production' && new URL(origin).protocol !== 'https:')
    throw new Error('STAFF_CONFIGURATION');
  if (env.STAFF_SESSION_SECRET!.length < 32 || env.STAFF_SESSION_SECRET === env.WEB_SESSION_SECRET)
    throw new Error('STAFF_CONFIGURATION');
  const domain = new URL(env.STAFF_COGNITO_DOMAIN!);
  if (domain.protocol !== 'https:' || domain.pathname !== '/' || domain.search || domain.hash)
    throw new Error('STAFF_CONFIGURATION');
  return {
    issuer,
    clientId,
    clientSecret: env.STAFF_COGNITO_CLIENT_SECRET!,
    domain: domain.origin,
    region: match[1]!,
    poolId: match[2]!,
    origin,
    callback: `${origin}/api/auth/callback`,
    secret: env.STAFF_SESSION_SECRET!,
    api: env.PACHI_API_URL!,
  };
}
