/**
 * Cluster Mode Launcher
 *
 * Spawns one Express worker per CPU core for horizontal scaling.
 * Use this in production instead of index.ts:
 *
 *   node dist/cluster.js          # auto-detect cores
 *   WORKERS=4 node dist/cluster.js # fixed worker count
 *
 * Or use PM2 which handles clustering externally:
 *   pm2 start dist/index.js -i max
 */

import cluster from 'cluster';
import os from 'os';

const WORKERS = parseInt(process.env.WORKERS ?? String(os.cpus().length), 10);

if (cluster.isPrimary) {
  console.log(`[Cluster] Primary ${process.pid} starting ${WORKERS} workers...`);

  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[Cluster] Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Restarting...`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`[Cluster] Worker ${worker.process.pid} online`);
  });
} else {
  // Each worker runs the full Express app
  require('./index');
}
