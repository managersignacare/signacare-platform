#!/usr/bin/env node
/**
 * BUG-278 deploy-time probe:
 * verifies that Ollama prompt content is not written to configured log files.
 *
 * Usage:
 *   OLLAMA_LOG_FILES=/var/log/ollama/server.log \
 *   npm run probe:ollama-log-hygiene -w apps/api
 *
 * Optional flags:
 *   --base-url <url>     Ollama base URL (default: OLLAMA_BASE_URL or http://localhost:11434)
 *   --model <name>       Ollama model (default: OLLAMA_MODEL or llama3.2)
 *   --flush-ms <ms>      Wait after generate call before scanning logs (default: 1500)
 *   --log-file <path>    Repeatable additional log file path(s)
 */

import { existsSync, readFileSync } from 'node:fs';

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL ?? 'llama3.2',
    flushMs: 1500,
    logFiles: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--base-url') {
      out.baseUrl = argv[++i] ?? out.baseUrl;
      continue;
    }
    if (arg === '--model') {
      out.model = argv[++i] ?? out.model;
      continue;
    }
    if (arg === '--flush-ms') {
      const raw = argv[++i];
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) out.flushMs = parsed;
      continue;
    }
    if (arg === '--log-file') {
      const file = argv[++i];
      if (file) out.logFiles.push(file);
      continue;
    }
  }

  const envFiles = (process.env.OLLAMA_LOG_FILES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  out.logFiles.push(...envFiles);

  // De-duplicate while preserving order.
  out.logFiles = [...new Set(out.logFiles)];
  return out;
}

function usage() {
  console.log(`
BUG-278 Ollama log hygiene probe

Required:
  OLLAMA_LOG_FILES=/path/to/ollama.log[,/path/to/other.log]

Example:
  OLLAMA_BASE_URL=http://localhost:11434 \\
  OLLAMA_MODEL=qwen2.5:14b \\
  OLLAMA_LOG_FILES=/var/log/ollama/server.log \\
  npm run probe:ollama-log-hygiene -w apps/api
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function callGenerate(baseUrl, model, sentinel) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        prompt: `BUG-278-LOG-PROBE ${sentinel}\nRespond with exactly: OK`,
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      fail(`Ollama /api/generate failed (${response.status}). ${detail}`);
    }

    await response.text().catch(() => '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Ollama generate call failed: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

function scanLogs(logFiles, sentinel) {
  const missing = [];
  const hits = [];

  for (const file of logFiles) {
    if (!existsSync(file)) {
      missing.push(file);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (text.includes(sentinel)) {
      hits.push(file);
    }
  }

  return { missing, hits };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  if (opts.logFiles.length === 0) {
    usage();
    fail('No log files provided. Set OLLAMA_LOG_FILES or pass --log-file.');
  }

  const sentinel = `BUG278_SENTINEL_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  console.log(`→ probing Ollama generate path at ${opts.baseUrl} (model=${opts.model})`);
  await callGenerate(opts.baseUrl, opts.model, sentinel);
  await sleep(opts.flushMs);

  console.log(`→ scanning ${opts.logFiles.length} log file(s) for probe sentinel`);
  const { missing, hits } = scanLogs(opts.logFiles, sentinel);

  if (missing.length > 0) {
    fail(
      `Missing required Ollama log file(s): ${missing.join(
        ', ',
      )}. This probe is fail-closed; provide valid log paths.`,
    );
  }

  if (hits.length > 0) {
    fail(
      `Prompt sentinel detected in Ollama logs: ${hits.join(
        ', ',
      )}. Treat as PHI logging risk (BUG-278 containment).`,
    );
  }

  console.log('✓ BUG-278 probe passed: sentinel was not found in configured Ollama logs.');
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  fail(`Unexpected failure: ${msg}`);
});

