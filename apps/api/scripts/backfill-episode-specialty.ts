/**
 * apps/api/scripts/backfill-episode-specialty.ts
 *
 * Re-tags existing episodes with a best-guess `specialty_code` based on
 * the free-text `episode_type` column and a small keyword map. Safe to
 * run repeatedly: only episodes whose `specialty_code` is still the
 * default (`mental_health`) and whose inferred specialty is something
 * other than `mental_health` are updated.
 *
 * Dry-run by default — prints a per-specialty count and a sample of up
 * to 10 affected episode IDs, but writes nothing. Pass `--apply` to
 * actually execute the UPDATE.
 *
 * Run:
 *   ts-node -r dotenv/config -r tsconfig-paths/register \
 *     --project tsconfig.node.json \
 *     scripts/backfill-episode-specialty.ts             # dry-run
 *
 *   ts-node ... scripts/backfill-episode-specialty.ts --apply
 */

import knex from 'knex';
import path from 'path';
import { config } from '../src/config/config';

type SpecialtyCode =
  | 'mental_health'
  | 'general_medicine'
  | 'endocrinology'
  | 'paediatrics'
  | 'obstetrics_gynaecology'
  | 'surgery'
  | 'oncology';

// Keyword → specialty heuristics. First match wins; ordered most-specific
// first. Runs case-insensitively against `episode_type` and `title`.
const RULES: Array<[RegExp, SpecialtyCode]> = [
  [/\b(onc|cancer|chemo|tumou?r|radiation|radiotherapy|mcode|neoplasm)\b/i, 'oncology'],
  [/\b(obgyn|obstetric|gynae|antenatal|postnatal|pregnan|labou?r|delivery|maternal)\b/i, 'obstetrics_gynaecology'],
  [/\b(surg|operative|post[\s-]?op|pre[\s-]?op|theatre|pacu|anaesthe)/i, 'surgery'],
  [/\b(paed|pediatric|neonat|wellchild|immunisation|growth\s+chart)\b/i, 'paediatrics'],
  [/\b(endo|diabetes|thyroid|insulin|hba1c|cgm|hypoglyc)/i, 'endocrinology'],
  [/\b(general\s+med|internal\s+med|gim|chronic\s+disease|problem\s+list|med\s+rec)/i, 'general_medicine'],
];

function inferSpecialty(episodeType: string | null, title: string | null): SpecialtyCode {
  const haystack = `${episodeType ?? ''} ${title ?? ''}`;
  for (const [re, code] of RULES) {
    if (re.test(haystack)) return code;
  }
  return 'mental_health';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const db = knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
    },
    pool: { min: 1, max: 3 },
  });

  try {
    // Sanity: the column must exist.
    const hasCol = await db.schema.hasColumn('episodes', 'specialty_code');
    if (!hasCol) {
      console.error('✗ episodes.specialty_code does not exist. Run migrations first.');
      process.exit(1);
    }

    const rows = await db('episodes')
      .select('id', 'episode_type', 'title', 'specialty_code')
      .whereNull('deleted_at')
      .andWhere('specialty_code', 'mental_health');

    const plan: Record<SpecialtyCode, string[]> = {
      mental_health: [],
      general_medicine: [],
      endocrinology: [],
      paediatrics: [],
      obstetrics_gynaecology: [],
      surgery: [],
      oncology: [],
    };

    for (const row of rows) {
      const inferred = inferSpecialty(row.episode_type, row.title);
      if (inferred !== 'mental_health') plan[inferred].push(row.id);
    }

    const affected = Object.values(plan).reduce((acc, ids) => acc + ids.length, 0);

    console.log(`\nBackfill plan (episodes to re-tag from mental_health):`);
    console.log(`  scanned:  ${rows.length}`);
    console.log(`  affected: ${affected}`);
    console.log('');
    for (const [code, ids] of Object.entries(plan)) {
      if (ids.length === 0) continue;
      console.log(`  ${code.padEnd(22)} ${String(ids.length).padStart(6)}  sample: ${ids.slice(0, 10).join(', ')}`);
    }
    console.log('');

    if (!apply) {
      console.log('Dry run — no changes written. Re-run with --apply to execute.');
      return;
    }

    if (affected === 0) {
      console.log('Nothing to update.');
      return;
    }

    await db.transaction(async (trx) => {
      for (const [code, ids] of Object.entries(plan)) {
        if (ids.length === 0) continue;
        await trx('episodes')
          .whereIn('id', ids)
          .update({ specialty_code: code, updated_at: trx.fn.now() });
      }
    });

    console.log(`✓ Updated ${affected} episodes.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('✗ Backfill failed:', err);
  process.exit(1);
});

// Silence unused-path warning if config resolver renames the file.
void path;
