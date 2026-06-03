# Signacare EMR — Production Deployment Guide

## 1. Rate Limiter Configuration

### Current Defaults
| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 300 req/min | 1 min |
| Auth (login) | 20 attempts | 15 min |
| AI/LLM | 30 req/min | 1 min |

### Production Tuning
Set via environment variables in `.env`:
```env
# Rate limiting
RATE_LIMIT_GENERAL=500       # Increase for large deployments
RATE_LIMIT_AUTH=30            # Keep strict for security
LLM_RATE_LIMIT=50            # Increase if many clinicians use AI Scribe
```

### If Rate Limited
The API returns `429 Too Many Requests`. The frontend auto-retries after the window.
To clear rate limits manually: `redis-cli FLUSHALL`

---

## 2. Preventing API/Server Downtime

### Auto-Restart on Crash (PM2)
Install PM2 for process management:
```bash
npm install -g pm2

# Start with auto-restart
pm2 start ~/signacare/app/apps/api/src/index.ts \
  --interpreter npx \
  --interpreter-args "ts-node -r dotenv/config -r tsconfig-paths/register --project tsconfig.node.json" \
  --name signacare-api \
  --max-restarts 10 \
  --restart-delay 5000

# Start web server
pm2 start "npx serve -s dist -l 5173" --name signacare-web --cwd ~/signacare/app/apps/web

# Start Whisper
pm2 start ~/signacare/whisper-server/server.py \
  --interpreter ~/signacare/whisper-server/venv/bin/python \
  --name signacare-whisper \
  -- --port 8080

# Save and enable startup
pm2 save
pm2 startup
```

### Health Checks
- `GET /health` — Basic API health
- `GET /ready` — Checks database connectivity

Use these with monitoring tools (Uptime Robot, Pingdom, or custom script):
```bash
# Simple health check script
curl -sf http://localhost:4000/health || (pm2 restart signacare-api && echo "API restarted")
```

### Auto-Start on Boot
Already configured via macOS LaunchAgent:
- `~/Library/LaunchAgents/com.signacare.signacare.plist`
- Starts all services on login

### For Linux/Docker Production
```yaml
# docker-compose.yml
services:
  api:
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

---

## 3. Database Protection

### Connection Pooling
- Knex pool: min 5, max 50 (auto-adjusts for PgBouncer)
- PgBouncer: transaction-level pooling for 600+ concurrent connections
- Statement timeout: 30s (prevents runaway queries)

### Automated Backups
- Daily at 2:00 AM via LaunchAgent
- 30-day retention
- Location: `~/signacare/data/backups/`

### WAL Archiving (for zero-RPO)
```bash
# In postgresql.conf:
archive_mode = on
archive_command = 'cp %p /path/to/wal_archive/%f'
```

---

## 4. Monitoring

### Sentry Error Tracking
Set `SENTRY_DSN` in `.env` to enable automatic error reporting.

### Log Aggregation
API logs are JSON (Pino format) to stdout. Pipe to:
- File: `>> ~/signacare/logs/api.log`
- ELK: via Filebeat
- CloudWatch: via agent

### Uptime Monitoring
Free options:
- Uptime Robot (https://uptimerobot.com) — monitors `/health`
- Better Stack (https://betterstack.com) — includes alerting

---

## 5. Security Checklist for Production

- [ ] Change all JWT secrets (min 64 chars, cryptographically random)
- [ ] Set `NODE_ENV=production`
- [ ] Enable TLS (uncomment TLS_CERT_PATH and TLS_KEY_PATH)
- [ ] Set `CORS_ORIGIN` to the exact production domain
- [ ] Set `IP_ALLOWLIST` if restricting to known networks
- [ ] Change database password from 'signacare' to a strong random password
- [ ] Enable `DB_SSL=true` for encrypted database connections
- [ ] Set `SIGNACARE_LICENSE_SECRET` to a unique 64-char key
- [ ] Review and set `LLM_RATE_LIMIT` based on expected usage
- [ ] Verify automated backups are running
- [ ] Test restore from backup
- [ ] Enable Sentry (`SENTRY_DSN`)

---

## 6. Scaling for 1000+ Users

| Component | Current | Production |
|-----------|---------|-----------|
| API instances | 1 | 2-4 (behind load balancer) |
| DB pool | 50 | PgBouncer with 600 max_client_conn |
| Redis | Single | Redis Sentinel for HA |
| PostgreSQL | Single | Primary + Read Replica |
| Rate limit storage | Redis | Redis (shared across instances) |
| Sessions | Redis | Redis (shared across instances) |

### Horizontal Scaling
```bash
# Run multiple API instances on different ports
PORT=4000 pm2 start api --name api-1
PORT=4001 pm2 start api --name api-2

# Nginx load balancer
upstream signacare_api {
    server 127.0.0.1:4000;
    server 127.0.0.1:4001;
}
```
