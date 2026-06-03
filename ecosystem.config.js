/**
 * PM2 Ecosystem Configuration
 *
 * Cluster mode uses all CPU cores for ~4x throughput.
 *
 * Usage:
 *   Development:  pm2 start ecosystem.config.js --only signacare-api-dev
 *   Production:   pm2 start ecosystem.config.js --only signacare-api
 *   Monitor:      pm2 monit
 *   Logs:         pm2 logs signacare-api
 *   Reload:       pm2 reload signacare-api (zero-downtime)
 *   Stop:         pm2 stop all
 */

module.exports = {
  apps: [
    // ── Production API (cluster mode) ──
    {
      name: 'signacare-api',
      script: 'apps/api/dist/src/index.js',
      instances: 'max',            // Use all CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Graceful reload
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      // Auto-restart on crash
      max_restarts: 10,
      min_uptime: '10s',
      // Memory limit — restart if exceeds
      max_memory_restart: '512M',
      // Logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      // Watch (disabled in production)
      watch: false,
    },

    // ── Development API (fork mode, with ts-node) ──
    {
      name: 'signacare-api-dev',
      script: 'apps/api/src/index.ts',
      interpreter: './node_modules/.bin/ts-node',
      interpreter_args: '-r dotenv/config -r tsconfig-paths/register --project apps/api/tsconfig.node.json',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
      },
      watch: ['apps/api/src'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'dist', 'logs', '*.log'],
      max_memory_restart: '1G',
    },

    // ── BullMQ Workers (background jobs) ──
    {
      name: 'signacare-workers',
      script: 'apps/api/dist/jobs/bootstrap.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '256M',
      error_file: './logs/workers-error.log',
      out_file: './logs/workers-out.log',
    },
  ],
};
