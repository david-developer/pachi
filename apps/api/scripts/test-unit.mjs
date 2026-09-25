import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function files(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts') && !entry.name.endsWith('.integration.test.ts'))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

const testFiles = await files(new URL('../src', import.meta.url));
if (testFiles.length === 0) process.exit(0);
const result = spawnSync('pnpm', ['exec', 'tsx', '--test', ...testFiles], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
