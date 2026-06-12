/**
 * Phase 7 — Word Error Rate utility for the ASR benchmark.
 *
 * Standard Levenshtein-over-words: WER = (S + D + I) / N where:
 *   - S = substitutions
 *   - D = deletions
 *   - I = insertions
 *   - N = number of words in the reference
 *
 * Pure function, no dependencies, no I/O. The harness imports this to
 * compute per-clip WER vs the seed-corpus reference transcript.
 */

export interface WerResult {
  /** WER = (sub + del + ins) / referenceWordCount, in [0, +∞). */
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWordCount: number;
  hypothesisWordCount: number;
}

function normalise(text: string): string[] {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter((w) => w.length > 0);
}

export function computeWer(reference: string, hypothesis: string): WerResult {
  const ref = normalise(reference);
  const hyp = normalise(hypothesis);
  const refN = ref.length;
  const hypN = hyp.length;

  if (refN === 0) {
    return {
      wer: hypN === 0 ? 0 : Number.POSITIVE_INFINITY,
      substitutions: 0,
      deletions: 0,
      insertions: hypN,
      referenceWordCount: 0,
      hypothesisWordCount: hypN,
    };
  }

  // Levenshtein on words, with traceback to count S/D/I.
  // d[i][j] = best cost to align ref[0..i] with hyp[0..j].
  const d: number[][] = Array.from({ length: refN + 1 }, () => Array(hypN + 1).fill(0));
  for (let i = 0; i <= refN; i++) d[i][0] = i;
  for (let j = 0; j <= hypN; j++) d[0][j] = j;
  for (let i = 1; i <= refN; i++) {
    for (let j = 1; j <= hypN; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion (ref token unaligned)
        d[i][j - 1] + 1,      // insertion (extra hyp token)
        d[i - 1][j - 1] + cost, // substitution / match
      );
    }
  }

  // Traceback to break the total edit distance into S / D / I.
  let i = refN;
  let j = hypN;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substitutions++;
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  return {
    wer: (substitutions + deletions + insertions) / refN,
    substitutions,
    deletions,
    insertions,
    referenceWordCount: refN,
    hypothesisWordCount: hypN,
  };
}

/**
 * Token-overlap score (Jaccard over unigram word sets, normalised).
 * Useful as a secondary signal when WER is dominated by repeated
 * filler-word substitutions that don't change clinical meaning.
 */
export function tokenOverlap(reference: string, hypothesis: string): number {
  const refSet = new Set(normalise(reference));
  const hypSet = new Set(normalise(hypothesis));
  if (refSet.size === 0 && hypSet.size === 0) return 1;
  let intersect = 0;
  for (const w of refSet) if (hypSet.has(w)) intersect++;
  const unionSize = refSet.size + hypSet.size - intersect;
  return unionSize === 0 ? 0 : intersect / unionSize;
}
