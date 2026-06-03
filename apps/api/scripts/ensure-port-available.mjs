#!/usr/bin/env node
import net from 'node:net';

const port = Number.parseInt(process.env.PORT ?? '4000', 10);
const host = process.env.HOST ?? '0.0.0.0';

const server = net.createServer();

server.once('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(`[dev:preflight] Port ${port} is already in use. Stop the existing API process or change PORT.`);
    process.exit(1);
  }
  console.error('[dev:preflight] Unable to validate API port availability:', error);
  process.exit(1);
});

server.listen(port, host, () => {
  server.close(() => process.exit(0));
});
