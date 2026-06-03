// PM2 ecosystem config for production deployment
// Start with: npm run prod:start (from repo root)
// Or directly: pm2 start ecosystem.config.js --env production
//
// Cluster mode runs N workers (default 4), each handling ~1000 req/min.
// Combined with PgBouncer and read replicas, supports 200+ concurrent clinicians.
//
// Key features:
// - wait_ready: server signals readiness after DB/Redis checks pass
// - kill_timeout: 10s for in-flight requests to complete on restart
// - max_memory_restart: auto-restart if a worker leaks past 512MB
// - exp_backoff_restart_delay: prevents restart storms (100ms → 200ms → 400ms... → 15s cap)

module.exports = {
  apps: [
    {
      name: 'signacare-api',
      script: 'dist/src/index.js',
      cwd: __dirname,
      instances: process.env.API_INSTANCES || 4,
      exec_mode: 'cluster',
      max_memory_restart: '512M',

      // Environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,

        // Rate limits — scale with instance count
        API_RATE_LIMIT: 3000,    // 3000/min per IP (shared across cluster via Redis)
        AUTH_RATE_LIMIT: 30,     // 30 login attempts per 15min per IP
        LLM_RATE_LIMIT: 50,     // 50 AI requests per min per IP

        // DB — point to PgBouncer when available
        // DB_HOST: 'pgbouncer',
        // DB_PORT: 6432,
        // DB_POOL_MAX: 10,      // Lower when PgBouncer manages pooling

        // Trust proxy (behind Nginx/ALB)
        TRUST_PROXY: '1',
      },

      // Readiness: server calls process.send('ready') after DB/Redis connect
      wait_ready: true,
      listen_timeout: 15000,

      // Graceful shutdown: 10s for in-flight requests before SIGKILL
      kill_timeout: 10000,
      shutdown_with_message: true,

      // Auto-restart with exponential backoff (prevents restart storms)
      autorestart: true,
      max_restarts: 15,
      exp_backoff_restart_delay: 100,  // 100ms → 200ms → 400ms... caps at 15s

      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Source map support for stack traces
      source_map_support: true,
    },
  ],
};
