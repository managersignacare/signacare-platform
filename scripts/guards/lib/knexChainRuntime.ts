import { stripCommentsPreservingLayout } from './guardRuntime';

export { stripCommentsPreservingLayout };

export function findDbAliasIdentifiers(source: string): Set<string> {
  const aliases = new Set<string>();
  const re =
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*[\w$]+\s*\?\?\s*(?:db|dbRead|trx|dbAdmin)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    aliases.add(m[1]);
  }
  return aliases;
}

export function buildDbOpenerRegex(extraAliases: Set<string>): RegExp {
  const aliasList = ['db', 'dbRead', 'trx', 'dbAdmin', ...extraAliases]
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(
    `(?:\\b(?:${aliasList})(?:<[^<>(){}]+>)?\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])` +
      `|(?:\\(\\s*[\\w$.]+\\s*\\?\\?\\s*(?:db|dbRead|trx|dbAdmin)\\s*\\)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])`,
    'g',
  );
}

/** Walk forward from openerStart through balanced parens until end of statement. */
export function findChainEnd(source: string, openerStart: number): number {
  let i = openerStart;
  const n = source.length;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  while (i < n) {
    const c = source[i];
    if (c === '(') parenDepth++;
    else if (c === ')') {
      if (parenDepth === 0) return i;
      parenDepth--;
    } else if (c === '[') bracketDepth++;
    else if (c === ']') {
      if (bracketDepth === 0) return i;
      bracketDepth--;
    } else if (c === '{') braceDepth++;
    else if (c === '}') {
      if (braceDepth === 0) return i;
      braceDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (c === ';') return i;
      if (c === ',') return i;
    }
    i++;
  }
  return n;
}

export function parseTableAlias(spec: string): { table: string; alias: string } {
  const m = spec.match(/^(\S+)\s+as\s+(\S+)$/i);
  if (m) return { table: m[1], alias: m[2] };
  return { table: spec, alias: spec };
}
