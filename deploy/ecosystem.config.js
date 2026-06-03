/**
 * PM2 Ecosystem Config — Production Deployment
 *
 * Deploy across N API servers for high concurrency:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only signacare-api
 *
 * S2.1 update: paths now point at the compiled output in dist/src/...
 * (the build root is the api package itself, not the repo). The
 * `signacare-api` cluster process now ALSO starts the BullMQ workers and
 * node-cron schedulers in-process via server.ts (see S2.1 commit), so
 * the separate `signacare-workers` fork is no longer required for the basic
 * single-server case. It is kept here, commented out, for the
 * horizontally-scaled case where one dedicated worker process runs
 * alongside N stateless API processes.
 */

module.exports = {
  apps: [
    {
      name: 'signacare-api',
      cwd: './apps/api',
      script: 'dist/src/index.js',
      instances: process.env.WORKERS || 'max',  // 1 per CPU core
      exec_mode: 'cluster',
      node_args: '-r dotenv/config',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Graceful shutdown
      kill_timeout: 35000,   // Must exceed server's 30s graceful shutdown
      listen_timeout: 15000,
      wait_ready: true,      // Wait for process.send('ready') before considering online
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      // Memory limit — restart if worker exceeds 512MB (leak protection)
      max_memory_restart: '512M',
      // Logging
      error_file: '/var/log/signacare/api-error.log',
      out_file: '/var/log/signacare/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Health check
      exp_backoff_restart_delay: 100,
    },
    // Optional: dedicated workers process for horizontally-scaled deploys.
    // Uncomment when running multiple API instances behind a load balancer
    // and you want a single bullmq worker process per cluster (not per
    // API replica). The script must call startWorkers()+startSchedulers()
    // explicitly — it is no longer a side-effect of import.
    // {
    //   name: 'signacare-workers',
    //   cwd: './apps/api',
    //   script: 'dist/scripts/runWorkers.js',  // (not yet shipped)
    //   instances: 1,
    //   exec_mode: 'fork',
    //   env: { NODE_ENV: 'production' },
    //   autorestart: true,
    //   max_memory_restart: '256M',
    //   error_file: '/var/log/signacare/workers-error.log',
    //   out_file: '/var/log/signacare/workers-out.log',
    // },
  ],
};
