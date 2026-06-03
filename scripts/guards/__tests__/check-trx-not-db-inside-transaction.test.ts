/*
 * scripts/guards/__tests__/check-trx-not-db-inside-transaction.test.ts
 *
 * Phase R1 PR-R1-5 cycle-2 absorb (L3 finding #5 P2) — direct-import
 * vitest spec. Cycle-1 spawned `npx tsx` per test (~6.4s for 9 tests
 * + synthetic-file scaffolding under apps/api/src/features/). Cycle-2
 * imports the guard's helpers directly and runs in milliseconds —
 * matches the PR-R1-3 sibling pattern.
 *
 * Coverage classes (cycle-2 expanded — 18 tests):
 *
 *   POSITIVE flag:
 *     - direct `db(...)` / `dbRead(...)` inside transaction
 *     - direct `db.raw(...)` inside transaction
 *     - repo-helper call without `trx` (canonical CLAUDE.md §2.1 leak)
 *     - multi-violation in same callback body
 *     - function-expression callback (not just arrow)
 *     - nested transaction outer-leak (inner doesn't double-flag)
 *
 *   NEGATIVE accept:
 *     - correct `trx(...)` / `trx.raw(...)`
 *     - repo-helper that DOES pass `trx`
 *     - repo-helper that passes `{ trx }` shorthand
 *     - mapper / pure-helper call (not repo-named)
 *     - nested transaction with proper `innerTrx`
 *     - inline `// @trx-not-needed:` annotation opt-out
 *     - file with no transactions
 */
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import {
  isTransactionCall,
  getTransactionCallback,
  getTrxParamName,
  isRepoHelperCall,
  callPassesTrx,
  scanForForbiddenCalls,
} from '../check-trx-not-db-inside-transaction';

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
}

function findFirstTransactionCall(sourceFile: ts.SourceFile): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  function visit(node: ts.Node) {
    if (found) return;
    if (isTransactionCall(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * Run the equivalent of `scanFile` against an in-memory source — finds
 * the first transaction call, scans its callback body, returns findings.
 */
function scan(source: string) {
  const sourceFile = parse(source);
  const lines = source.split('\n');
  const tx = findFirstTransactionCall(sourceFile);
  if (!tx) return [];
  const cb = getTransactionCallback(tx);
  if (!cb || !cb.body) return [];
  const trxName = getTrxParamName(cb);
  return scanForForbiddenCalls(cb.body, sourceFile, lines, trxName);
}

describe('isTransactionCall', () => {
  it('matches db.transaction(...)', () => {
    const sf = parse(`db.transaction(async (trx) => {});`);
    const tx = findFirstTransactionCall(sf);
    expect(tx).not.toBeNull();
  });

  it('matches dbRead.transaction(...)', () => {
    const sf = parse(`dbRead.transaction(async (trx) => {});`);
    const tx = findFirstTransactionCall(sf);
    expect(tx).not.toBeNull();
  });

  it('does NOT match someOtherObj.transaction(...)', () => {
    const sf = parse(`appPoolRaw.transaction(async (trx) => {});`);
    const tx = findFirstTransactionCall(sf);
    expect(tx).toBeNull();
  });
});

describe('isRepoHelperCall', () => {
  it('matches xxxRepository.method(...)', () => {
    const sf = parse(`escalationRepository.findById(clinicId, id);`);
    let found = false;
    function visit(n: ts.Node) {
      if (isRepoHelperCall(n)) found = true;
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(found).toBe(true);
  });

  it('matches xxxRepo.method(...)', () => {
    const sf = parse(`patientRepo.update(...)`);
    let found = false;
    function visit(n: ts.Node) {
      if (isRepoHelperCall(n)) found = true;
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(found).toBe(true);
  });

  it('does NOT match mapXxxToResponse(...)', () => {
    const sf = parse(`const x = mapPatientToResponse(row);`);
    let found = false;
    function visit(n: ts.Node) {
      if (isRepoHelperCall(n)) found = true;
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(found).toBe(false);
  });
});

describe('callPassesTrx', () => {
  it('detects positional trx argument', () => {
    const sf = parse(`repo.method(clinicId, id, trx);`);
    let result = false;
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n)) result = callPassesTrx(n, 'trx');
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(result).toBe(true);
  });

  it('detects { trx } shorthand in options arg', () => {
    const sf = parse(`repo.method(clinicId, id, { trx });`);
    let result = false;
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && (n.expression as ts.PropertyAccessExpression).name?.text === 'method') {
        result = callPassesTrx(n, 'trx');
      }
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(result).toBe(true);
  });

  it('returns false when trx absent', () => {
    const sf = parse(`repo.method(clinicId, id);`);
    let result = true;
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && (n.expression as ts.PropertyAccessExpression).name?.text === 'method') {
        result = callPassesTrx(n, 'trx');
      }
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(sf, visit);
    expect(result).toBe(false);
  });
});

describe('scanForForbiddenCalls — POSITIVE flag', () => {
  it('flags direct db(...) inside transaction', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await db('foo').insert({});
      });
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('direct');
  });

  it('flags direct db.raw(...) inside transaction', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await db.raw('SELECT 1');
      });
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('direct-raw');
  });

  it('flags dbRead(...) inside dbRead.transaction()', () => {
    const findings = scan(`
      dbRead.transaction(async (trx) => {
        await dbRead('foo').select('*');
      });
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('direct');
  });

  it('flags repo-helper without trx (CLAUDE.md §2.1 canonical leak)', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await trx('escalations').insert({});
        const esc = await escalationRepository.findById(clinicId, id);
      });
    `);
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe('repo-no-trx');
    expect(findings[0].callee).toContain('escalationRepository.findById');
  });

  it('flags multiple violations in same callback', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await db('a').insert({});
        await db.raw('SELECT 1');
        const x = await someRepo.find(clinicId, id);
      });
    `);
    expect(findings.length).toBe(3);
  });

  it('flags function-expression callback (not arrow)', () => {
    const findings = scan(`
      db.transaction(async function (trx) {
        await db('foo').insert({});
      });
    `);
    expect(findings).toHaveLength(1);
  });
});

describe('scanForForbiddenCalls — NEGATIVE accept', () => {
  it('accepts trx(...) inside transaction', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await trx('foo').insert({});
        await trx.raw('SELECT 1');
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts repo-helper that DOES pass trx', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        const esc = await escalationRepository.findById(clinicId, id, trx);
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts repo-helper that passes { trx } shorthand', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        const x = await someRepo.find(clinicId, id, { trx });
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts mapper / pure helper (not repo-named)', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        await trx('foo').insert({});
        const out = mapFooToResponse(row);
        const iso = dateToIso(row.createdAt);
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts inline @trx-not-needed annotation opt-out', () => {
    const findings = scan(`
      db.transaction(async (trx) => {
        const id = await someRepo.generateId(); // @trx-not-needed: pure id generator
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts custom callback parameter name (e.g., tx)', () => {
    const findings = scan(`
      db.transaction(async (tx) => {
        await tx('foo').insert({});
        const x = await someRepo.find(id, tx);
      });
    `);
    expect(findings).toHaveLength(0);
  });

  it('accepts nested transaction (innermost gets its own scope)', () => {
    // Outer leak: db('a') — flagged
    // Inner is its own transaction so it gets its own scope and is
    // NOT scanned at outer level (would be at its own top-level visit).
    const findings = scan(`
      db.transaction(async (outerTrx) => {
        await db('a').insert({});
        return db.transaction(async (innerTrx) => {
          await innerTrx('b').insert({});
        });
      });
    `);
    // Only outer's db('a') is found at outer scope; nested transaction
    // sub-tree is skipped.
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('direct');
  });
});
