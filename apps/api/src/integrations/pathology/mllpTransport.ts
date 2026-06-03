/**
 * MLLP (Minimum Lower Layer Protocol) Transport for HL7 v2 Messages
 *
 * MLLP is the standard TCP transport for HL7 v2 in healthcare.
 * Used for sending pathology orders (ORM^O01) and receiving results (ORU^R01).
 *
 * Protocol: TCP socket with HL7 framing
 * - Start: 0x0B (VT)
 * - End: 0x1C 0x0D (FS CR)
 */

import net from 'net';
import { logger } from '../../utils/logger';

const VT = String.fromCharCode(0x0B);   // Vertical Tab — message start
const FS = String.fromCharCode(0x1C);   // File Separator — message end
const CR = String.fromCharCode(0x0D);   // Carriage Return

interface MllpConfig {
  host: string;
  port: number;
  timeout?: number; // ms, default 30000
}

function getLabConfig(): MllpConfig | null {
  const host = process.env.HL7_LAB_HOST;
  const port = parseInt(process.env.HL7_LAB_PORT ?? '', 10);
  if (!host || !port) return null;
  return { host, port, timeout: parseInt(process.env.HL7_LAB_TIMEOUT ?? '30000', 10) };
}

export function isMllpConfigured(): boolean {
  return getLabConfig() !== null;
}

/**
 * Send an HL7 message via MLLP and wait for ACK.
 */
export function sendMllpMessage(hl7Message: string): Promise<{ success: boolean; ack?: string; error?: string }> {
  return new Promise((resolve) => {
    const cfg = getLabConfig();
    if (!cfg) {
      resolve({ success: false, error: 'MLLP not configured. Set HL7_LAB_HOST and HL7_LAB_PORT.' });
      return;
    }

    const socket = new net.Socket();
    let responseData = '';
    let resolved = false;

    const finish = (result: { success: boolean; ack?: string; error?: string }) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(cfg.timeout ?? 30000);

    socket.connect(cfg.port, cfg.host, () => {
      logger.info({ host: cfg.host, port: cfg.port }, '[MLLP] Connected to lab');
      // Frame the HL7 message with MLLP envelope
      const framed = VT + hl7Message + FS + CR;
      socket.write(framed);
    });

    socket.on('data', (data) => {
      responseData += data.toString();
      // Check for complete MLLP message (ends with FS CR)
      if (responseData.includes(FS)) {
        const ack = responseData.replace(VT, '').replace(FS + CR, '').replace(FS, '').trim();
        const isAck = ack.includes('MSA|AA') || ack.includes('MSA|CA');
        const isNack = ack.includes('MSA|AE') || ack.includes('MSA|AR') || ack.includes('MSA|CR');

        if (isAck) {
          logger.info('[MLLP] ACK received');
          finish({ success: true, ack });
        } else if (isNack) {
          logger.warn({ ack }, '[MLLP] NACK received');
          finish({ success: false, ack, error: 'Lab rejected the message (NACK)' });
        } else {
          // Treat as ACK if we got a response
          finish({ success: true, ack });
        }
      }
    });

    socket.on('timeout', () => {
      logger.error('[MLLP] Connection timeout');
      finish({ success: false, error: 'MLLP connection timeout' });
    });

    socket.on('error', (err) => {
      logger.error({ err: err.message }, '[MLLP] Socket error');
      finish({ success: false, error: `MLLP socket error: ${err.message}` });
    });

    socket.on('close', () => {
      if (!resolved) finish({ success: false, error: 'Connection closed before ACK received' });
    });
  });
}

/**
 * Start an MLLP listener for incoming HL7 messages (results from lab).
 * Messages are pushed to the hl7-inbound BullMQ queue for async processing.
 */
export function startMllpListener(
  port: number,
  onMessage: (hl7Message: string, remoteAddress: string) => void,
): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info({ remote }, '[MLLP Listener] Connection from lab');

    socket.on('data', (data) => {
      buffer += data.toString();

      // Extract complete MLLP messages
      while (buffer.includes(FS)) {
        const startIdx = buffer.indexOf(VT);
        const endIdx = buffer.indexOf(FS);
        if (startIdx === -1 || endIdx === -1) break;

        const message = buffer.substring(startIdx + 1, endIdx).trim();
        buffer = buffer.substring(endIdx + 2); // Skip FS + CR

        if (message) {
          logger.info({ remote, msgLength: message.length }, '[MLLP Listener] Received HL7 message');
          onMessage(message, remote);

          // Send ACK
          const mshFields = message.split('\r')[0]?.split('|') ?? [];
          const msgId = mshFields[9] ?? 'UNKNOWN';
          const ack = `MSH|^~\\&|SIGNACARE_EMR||LAB||${new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14)}||ACK^R01|ACK-${msgId}|P|2.5\rMSA|AA|${msgId}`;
          socket.write(VT + ack + FS + CR);
        }
      }
    });

    socket.on('error', (err) => {
      logger.error({ err: err.message, remote }, '[MLLP Listener] Socket error');
    });
  });

  server.listen(port, () => {
    logger.info({ port }, '[MLLP Listener] Listening for incoming HL7 messages');
  });

  return server;
}
