import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  COGNITO_ISSUER: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  COGNITO_JWKS_URI: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  COGNITO_CLIENT_IDS: z.string().default('').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  AUTH_REQUIRED_SCOPES: z.string().default('').transform((value) => value.split(/\s+/).map((item) => item.trim()).filter(Boolean)),
  AUTH_ALLOW_TEST_ISSUER: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production') {
    if (!config.COGNITO_ISSUER || !config.COGNITO_JWKS_URI || config.COGNITO_CLIENT_IDS.length === 0) {
      context.addIssue({ code: 'custom', message: 'Production requires Cognito issuer, JWKS URI, and client IDs', path: ['COGNITO_ISSUER'] });
    }
    if (config.AUTH_ALLOW_TEST_ISSUER || config.COGNITO_ISSUER?.startsWith('https://local.test/')) {
      context.addIssue({ code: 'custom', message: 'Test issuer configuration is forbidden in production', path: ['AUTH_ALLOW_TEST_ISSUER'] });
    }
    if (config.AUTH_REQUIRED_SCOPES.length === 0) {
      context.addIssue({ code: 'custom', message: 'Production requires at least one API scope', path: ['AUTH_REQUIRED_SCOPES'] });
    }
  }
});

export type AppConfig = z.infer<typeof schema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig { return schema.parse(environment); }
