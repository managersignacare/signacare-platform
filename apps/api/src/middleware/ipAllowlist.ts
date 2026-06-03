/**
 * IP Allowlist Middleware
 *
 * Restricts API access to known IP addresses when IP_ALLOWLIST is set.
 * Format: IP_ALLOWLIST=192.168.1.0/24,10.0.0.0/8,203.0.113.5
 *
 * If IP_ALLOWLIST is not set, all IPs are allowed (open access).
 * Always allows localhost/loopback for local development.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const ALWAYS_ALLOWED = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];

function ipToLong(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isInCidr(ip: string, cidr: string): boolean {
  if (!ip.includes('.')) return false; // Skip IPv6
  const [network, bits] = cidr.split('/');
  if (!bits) return ip === network;
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(network) & mask);
}

let allowedRanges: string[] | null = null;

function loadAllowlist(): string[] | null {
  const raw = process.env.IP_ALLOWLIST;
  if (!raw || raw.trim() === '') return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function ipAllowlistMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (allowedRanges === null && !process.env.IP_ALLOWLIST) {
    // No allowlist configured — allow all
    next();
    return;
  }

  if (allowedRanges === null) {
    allowedRanges = loadAllowlist();
  }

  if (!allowedRanges || allowedRanges.length === 0) {
    next();
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '';

  // Always allow localhost
  if (ALWAYS_ALLOWED.includes(clientIp)) {
    next();
    return;
  }

  // Strip ::ffff: prefix for IPv4-mapped IPv6
  const normalizedIp = clientIp.replace(/^::ffff:/, '');

  const allowed = allowedRanges.some(range => isInCidr(normalizedIp, range));

  if (!allowed) {
    logger.warn({ ip: clientIp, path: req.path }, 'IP not in allowlist — blocked');
    res.status(403).json({ error: 'Access denied', code: 'IP_NOT_ALLOWED' });
    return;
  }

  next();
}
