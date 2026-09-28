import { spawnSync } from 'node:child_process';
const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL is required for API integration tests');
const parsed = new URL(url);
if (parsed.hostname !== 'localhost' || parsed.port !== '5433' || parsed.pathname !== '/pachi_test') throw new Error('DATABASE_TEST_URL must target localhost:5433/pachi_test');
const result = spawnSync('pnpm', ['exec', 'tsx', '--test', '--test-concurrency=1', 'src/*.http.integration.test.ts'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_TEST_URL: url }, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);