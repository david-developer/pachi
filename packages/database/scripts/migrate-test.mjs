import { spawnSync } from 'node:child_process';
const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL is required for test migrations');
const parsed = new URL(url);
if (parsed.hostname !== 'localhost' || parsed.port !== '5433' || parsed.pathname !== '/pachi_test') throw new Error('DATABASE_TEST_URL must target localhost:5433/pachi_test');
const result = spawnSync('pnpm', ['exec', 'tsx', 'src/migrate.ts'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
process.exit(result.status ?? 1);