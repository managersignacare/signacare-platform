export interface PrefixMatchOptions {
  /** When true, `foo_bar` style boundaries count as a prefix match. */
  allowUnderscoreBoundary?: boolean;
}

function hasPrefixBoundary(nextChar: string | undefined, allowUnderscoreBoundary: boolean): boolean {
  if (!nextChar) return false;
  if (allowUnderscoreBoundary && nextChar === '_') return true;
  const code = nextChar.charCodeAt(0);
  return code >= 65 && code <= 90; // A-Z
}

/**
 * Match method names against action prefixes with camelCase boundary checks.
 *
 * Examples for prefix `update`:
 * - `update`     -> true
 * - `updateName` -> true
 * - `updatedAt`  -> false (not a boundary)
 * - `update_x`   -> true only when allowUnderscoreBoundary=true
 */
export function matchesMethodPrefix(
  name: string,
  prefixes: readonly string[],
  opts: PrefixMatchOptions = {},
): boolean {
  const allowUnderscoreBoundary = opts.allowUnderscoreBoundary ?? false;
  for (const p of prefixes) {
    if (name === p) return true;
    if (!name.startsWith(p)) continue;
    const next = name[p.length];
    if (hasPrefixBoundary(next, allowUnderscoreBoundary)) return true;
  }
  return false;
}
