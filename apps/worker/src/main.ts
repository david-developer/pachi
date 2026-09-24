const shutdown = (signal: string) => {
  console.log(JSON.stringify({ event: 'worker_shutdown', signal }));
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
console.log(JSON.stringify({ event: 'worker_started', mode: 'development-shell', jobs: [] }));
