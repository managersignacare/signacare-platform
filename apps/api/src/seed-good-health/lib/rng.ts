// Seeded pseudo-random generator (mulberry32). Deterministic across runs
// so generators that need "random" picks — a name from a pool, a weight
// gain curve, a CTCAE toxicity grade — produce byte-identical output on
// every reseed. Phase 0.8 determinism contract depends on this.
//
// Never import Math.random in any generator — every random draw must go
// through a SeededRng so determinism tests pass.

export interface SeededRng {
  nextInt(min: number, max: number): number;
  nextFloat(): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { value: T; weight: number }[]): T;
  fork(tag: string): SeededRng;
}

// FNV-1a 32-bit hash — deterministic seed derivation from a string tag.
// Used by fork() so child generators get a stable seed derived from
// parent seed + tag, rather than advancing the parent stream.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    nextFloat: next,
    nextInt(min, max) {
      if (max < min) throw new Error(`nextInt: max ${max} < min ${min}`);
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick: empty array');
      return items[Math.floor(next() * items.length)];
    },
    weighted(items) {
      const total = items.reduce((s, i) => s + i.weight, 0);
      if (total <= 0) throw new Error('weighted: non-positive total weight');
      let roll = next() * total;
      for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item.value;
      }
      return items[items.length - 1].value;
    },
    fork(tag) {
      return createRng((seed ^ fnv1a(tag)) >>> 0);
    },
  };
}
