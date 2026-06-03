const BULLMQ_EVICTION_WARNING =
  /^IMPORTANT! Eviction policy is ([^.]+)\. It should be "noeviction"$/;
let installed = false;
let emittedAllkeysInfo = false;

/**
 * BUG-720 — BullMQ emits a hard-coded warning whenever Redis policy is not
 * `noeviction`. Signacare's canonical runtime policy is `allkeys-lru` (BUG-708),
 * so this dependency warning is contradictory noise in probe runs.
 *
 * Policy:
 * - Suppress only the exact BullMQ message when policy is `allkeys-lru`.
 * - Emit one structured INFO line to preserve observability and explain why.
 * - Forward every other warning unchanged (including unexpected policies).
 */
export function installBullmqEvictionWarningPolicy(): void {
  if (installed) return;
  installed = true;

  const originalWarn = console.warn.bind(console);

  console.warn = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : null;
    const match = first ? BULLMQ_EVICTION_WARNING.exec(first.trim()) : null;
    if (match) {
      const policy = (match[1] ?? '').trim();
      if (policy.toLowerCase() === 'allkeys-lru') {
        if (!emittedAllkeysInfo) {
          emittedAllkeysInfo = true;
          process.stdout.write(
            '[BUG-720] Suppressed BullMQ noeviction warning; canonical Redis policy is allkeys-lru\n',
          );
        }
        return;
      }
    }
    originalWarn(...args);
  };
}

// Install at module-load time so server imports can pull in queue/worker
// modules without emitting contradictory BullMQ eviction-policy warnings.
installBullmqEvictionWarningPolicy();
