/**
 * HMAC Request Signing for External Integrations
 *
 * External systems (HL7 feeds, eRx, CMI) can authenticate via HMAC-SHA256
 * instead of JWT cookies. The client signs the request body with a shared secret.
 *
 * Headers:
 *   X-Signacare-Signature: sha256=<hex-digest>
 *   X-Signacare-Timestamp: <unix-timestamp>
 *   X-Signacare-Key-Id: <api-key-id>
 *
 * The signature covers: timestamp + method + path + body
 * Requests older than 5 minutes are rejected (replay protection).
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

interface ApiKey {
  id: string;
  secret: string;
  clinicId: string;
  name: string;
  permissions: string[];
}

// In production, load from database. For now, use env var.
function getApiKey(keyId: string): ApiKey | null {
  const raw = process.env.API_KEYS; // JSON array: [{"id":"key1","secret":"...","clinicId":"...","name":"HL7","permissions":["read"]}]
  if (!raw) return null;
  try {
    const keys: ApiKey[] = JSON.parse(raw);
    return keys.find(k => k.id === keyId) ?? null;
  } catch {
    return null;
  }
}

export function verifyHmacSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-signacare-signature'] as string;
  const timestamp = req.headers['x-signacare-timestamp'] as string;
  const keyId = req.headers['x-signacare-key-id'] as string;

  // If no HMAC headers, skip (let JWT auth handle it)
  if (!signature || !timestamp || !keyId) {
    next();
    return;
  }

  // Replay protection
  const requestAge = Date.now() - parseInt(timestamp, 10) * 1000;
  if (isNaN(requestAge) || requestAge > MAX_AGE_MS || requestAge < -MAX_AGE_MS) {
    res.status(401).json({ error: 'Request timestamp expired', code: 'HMAC_EXPIRED' });
    return;
  }

  // Lookup API key
  const apiKey = getApiKey(keyId);
  if (!apiKey) {
    res.status(401).json({ error: 'Invalid API key', code: 'HMAC_INVALID_KEY' });
    return;
  }

  // Compute expected signature
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
  const payload = `${timestamp}.${req.method}.${req.path}.${body}`;
  const expected = 'sha256=' + crypto.createHmac('sha256', apiKey.secret).update(payload).digest('hex');

  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn({ keyId, path: req.path }, 'HMAC signature mismatch');
    res.status(401).json({ error: 'Invalid signature', code: 'HMAC_INVALID' });
    return;
  }

  // Set clinic context from API key
  req.clinicId = apiKey.clinicId;
  req.apiKeyId = apiKey.id;
  req.apiKeyPermissions = apiKey.permissions;

  logger.info({ keyId, path: req.path }, 'HMAC authenticated');
  next();
}
