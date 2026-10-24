import { networkInterfaces } from 'node:os';
import { serve } from '@hono/node-server';
import { ConfigError, loadConfig, loadDotEnv } from './config.ts';
import { createServer } from './server.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

loadDotEnv();
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const { app, close, users, slots } = createServer(config);

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const people = users.list();
  console.log(`Winnow on http://localhost:${info.port} (LAN: http://${lanAddress()}:${info.port})`);
  console.log(`Library: ${config.root}`);
  console.log(
    `${people.length} people: ${people.map((u) => `${u.id}${u.admin ? ' (admin)' : ''}`).join(', ') || 'none yet'}`,
  );
  console.log(`Run slots: scans ${slots.stats().scan.max}, AI ${slots.stats().ai.max}`);
  if (!people.length) console.log('Add someone: pnpm users add <id> <email> [name]');
  if (config.replayDir) console.log(`Replay mode (no CLI, no tokens): ${config.replayDir}`);
});

const shutdown = () => {
  server.close();
  void close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
