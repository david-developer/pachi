import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function developmentEnvironment(root, service, inherited = process.env) {
  // Explicit OS allowlist: never carry test issuers, NODE_OPTIONS, CI, database
  // overrides or Next's internal environment cache from the caller into a service.
  const environment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TERM', 'LANG', 'SYSTEMROOT']
    .filter((key) => inherited[key] !== undefined).map((key) => [key, inherited[key]]));
  const read = (path) => {
    try { return parseEnv(readFileSync(new URL(path, root), 'utf8')); }
    catch { throw new Error(`Cannot read ${path}; configure the existing ignored development environment.`); }
  };
  Object.assign(environment, read('.env'));
  if (service === 'web') Object.assign(environment, read('apps/web/.env'));
  delete environment.CI;
  delete environment.DATABASE_TEST_URL;
  delete environment.NODE_OPTIONS;
  environment.NODE_ENV = 'development';
  if (environment.AUTH_ALLOW_TEST_ISSUER === 'true') throw new Error('Development services cannot enable the test issuer.');
  environment.AUTH_ALLOW_TEST_ISSUER = 'false';
  let database;
  try { database = new URL(environment.DATABASE_URL); } catch { throw new Error('Invalid development DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== 'localhost' || database.port !== '5432' || database.pathname !== '/pachi_local') {
    throw new Error('Development services require localhost:5432/pachi_local; tests use a separate launcher.');
  }
  const required = service === 'api'
    ? ['COGNITO_ISSUER', 'COGNITO_JWKS_URI', 'COGNITO_CLIENT_IDS', 'AUTH_REQUIRED_SCOPES']
    : service === 'web' ? ['COGNITO_ISSUER', 'COGNITO_CLIENT_ID', 'COGNITO_CLIENT_SECRET', 'COGNITO_REDIRECT_URI', 'WEB_SESSION_SECRET', 'PACHI_API_URL'] : [];
  for (const key of required) if (!environment[key]?.trim()) throw new Error(`Missing ${key} in development environment files.`);
  if (service !== 'worker' && !environment.COGNITO_ISSUER.startsWith('https://cognito-idp.')) throw new Error('Development login requires the configured Cognito issuer.');
  if (service === 'api' && !environment.AUTH_REQUIRED_SCOPES.split(/\s+/).includes('pachi/account')) throw new Error('API requires the pachi/account scope.');
  if (service === 'web' && environment.WEB_SESSION_SECRET.length < 32) throw new Error('WEB_SESSION_SECRET must contain at least 32 characters.');
  return environment;
}
