/**
 * EMR Gateway — Read-Only Microservice for Zitavi Patient Mobile App
 *
 * Connects to existing MongoDB (read-only) and serves data to EMR systems.
 * Start: npm run dev (development) or npm start (production)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { env } from './config/env';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';
import viewRoutes from './routes/views';

const app = express();

// ── Middleware ──
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(rateLimiter);

// ── View Engine ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Health Check (no auth) ──
app.get('/emr/health', (_req, res) => res.json({ status: 'ok', service: 'emr-gateway', timestamp: new Date() }));

// ── View Routes (HTML pages for iframe embedding) ──
app.use('/emr/view', viewRoutes);

// ── API Routes (auth required) ──
app.use('/emr', apiKeyAuth, routes);

// ── Error Handler ──
app.use(errorHandler);

// ── Start ──
async function start() {
  if (env.mongoUri) {
    try {
      await mongoose.connect(env.mongoUri);
      console.log(`[EMR Gateway] Connected to MongoDB`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[EMR Gateway] MongoDB not available: ${message}. Running without database.`);
    }
  } else {
    console.warn('[EMR Gateway] MONGO_URI not set — running without database connection');
  }

  app.listen(env.port, () => {
    console.log(`[EMR Gateway] Running on port ${env.port} (${env.nodeEnv})`);
    console.log(`[EMR Gateway] API: http://localhost:${env.port}/emr/patients`);
    console.log(`[EMR Gateway] Health: http://localhost:${env.port}/emr/health`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

export default app;
