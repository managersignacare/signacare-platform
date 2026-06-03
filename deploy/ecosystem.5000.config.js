// PM2 ecosystem config for 5,000 concurrent users
//
// Architecture:
//   12 Node.js workers × ~500 req/sec = 6,000 req/sec capacity
//   Each worker: 5 DB connections via PgBouncer = 60 client connections
//   PgBouncer: 60 client → 150 server connections to PostgreSQL
//   PostgreSQL: max_connections=300 (150 app + 50 admin + 100 headroom)
//
// Hardware requirements:
//   CPU: 8+ cores (12 recommended)
//   RAM: 8GB minimum (16GB recommended)
//   Disk: SSD for PostgreSQL WAL
//   Network: 1Gbps for SSE streaming
//
// Start: pm2 start deploy/ecosystem.5000.config.js

module.exports = {
  apps: [
    {
      name: 'signacare-api',
      script: 'dist/index.js',
      cwd: './apps/api',
      instances: process.env.API_WORKERS || 12,
      exec_mode: 'cluster',
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'production',
        PORT: 4000,

        // DB: point to PgBouncer, not PostgreSQL directly
        DB_HOST: process.env.PGBOUNCER_HOST || 'localhost',
        DB_PORT: 6432,
        DB_POOL_MAX: 5,       // 5 per worker × 12 workers = 60 client connections
        DB_POOL_MIN: 1,

        // Rate limiting: 5000 users × ~3 req/sec = 15,000 req/sec peak
        API_RATE_LIMIT: 5000,   // 5000/min per IP
        AUTH_RATE_LIMIT: 50,    // 50 login attempts per 15min per IP
        LLM_RATE_LIMIT: 100,   // 100 AI requests per min per IP

        // SSE
        SSE_MAX_CONNECTIONS: 5000,
        SSE_IDLE_TIMEOUT_MS: 300000, // 5 minutes

        // Trust proxy (behind Nginx/ALB)
        TRUST_PROXY: '1',
      },

      // Graceful restart
      kill_timeout: 15000,
      listen_timeout: 20000,
      wait_ready: true,
      shutdown_with_message: true,

      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Auto-restart
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
