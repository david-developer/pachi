import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { developmentEnvironment } from './dev-environment.mjs';

const root = new URL('../', import.meta.url);
const selected = process.argv[2] ?? 'all';
const services = selected === 'all' ? ['api', 'web', 'worker'] : [selected];
const locks = [];
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  // Each child has its own process group: only descendants started here receive
  // the signal. Never search or kill by a shared name such as tsx/next/node.
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  const timer = setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }
  }, 5000);
  Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve))))
    .then(() => { clearTimeout(timer); process.exit(code); });
}
process.on('exit', () => { for (const lock of locks) { try { unlinkSync(lock); } catch { /* absent */ } } });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is unavailable. Inspect its listener before stopping an identified project process.`)));
    server.listen(port, () => server.close(resolve));
  });
}

try {
  if (services.some((service) => !['api', 'web', 'worker'].includes(service))) throw new Error('Usage: pnpm dev [all|api|web|worker]');
  const environments = new Map(services.map((service) => [service, developmentEnvironment(root, service)]));
  mkdirSync(new URL('.local-dev/', root), { recursive: true });
  for (const service of services) {
    const lock = new URL(`.local-dev/${service}.pid`, root);
    try {
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid development PID file; inspect .local-dev.');
      try { process.kill(pid, 0); throw new Error(`${service} already has a running launcher (PID ${pid}).`); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      unlinkSync(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    locks.push(lock);
    if (service !== 'worker') await requireFreePort(service === 'web' ? 3000 : Number(environments.get(service).API_PORT ?? 3001));
  }
  // These packages export dist files. Build them before starting any app.
  const build = spawnSync('pnpm', ['--filter', '@pachi/database', '--filter', '@pachi/contracts', '--filter', '@pachi/media', '-r', 'build'], {
    cwd: root, env: environments.get(services[0]), stdio: 'inherit'
  });
  if (build.status !== 0) throw new Error('Shared-package build failed; services were not started.');
  for (const service of services) {
    const cwd = new URL(`apps/${service}/`, root);
    const args = service === 'web'
      ? [fileURLToPath(new URL('node_modules/next/dist/bin/next', cwd)), 'dev', '--port', '3000']
      : [fileURLToPath(new URL('node_modules/tsx/dist/cli.mjs', cwd)), 'watch', '--clear-screen=false', 'src/main.ts'];
    const child = spawn(process.execPath, args, { cwd, env: environments.get(service), stdio: ['inherit', 'pipe', 'pipe'], detached: true });
    const log = createWriteStream(new URL(`.local-dev/${service}.log`, root), { flags: 'a', mode: 0o600 });
    log.on('error', () => { console.error(`${service} log could not be written.`); stop(1); });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', () => log.end());
    children.push(child);
    console.log(JSON.stringify({ event: 'dev_service_started', service, pid: child.pid, environment_files: service === 'web' ? ['.env', 'apps/web/.env'] : ['.env'] }));
    child.on('error', () => { console.error(`${service} failed to start.`); stop(1); });
    child.on('exit', (code) => { if (!stopping) { console.error(`${service} exited; stopping this launcher's services.`); stop(code || 1); } });
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
