import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import { spawnSync } from 'child_process';

const PROJECT_ROOT = resolve(__dirname, '..', '..');
const CORPUS_DIRS = [
  'apps/web/src',
  'apps/mobile/lib',
  'apps/patient-app/lib',
  'docs/demo',
];
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.dart']);
const CJK_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u31F0-\u31FF\uAC00-\uD7AF]/g;

interface Args {
  scFont?: string;
  jpFont?: string;
  krFont?: string;
  outputDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { outputDir: 'apps/web/public/fonts' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];
    if (!value) continue;
    if (token === '--sc-font') args.scFont = value;
    if (token === '--jp-font') args.jpFont = value;
    if (token === '--kr-font') args.krFont = value;
    if (token === '--output-dir') args.outputDir = value;
  }
  return args;
}

function walk(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (TEXT_EXTS.has(extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function collectGlyphs(): string {
  const chars = new Set<string>();
  for (const rel of CORPUS_DIRS) {
    const abs = join(PROJECT_ROOT, rel);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(CJK_REGEX);
      if (!matches) continue;
      for (const c of matches) chars.add(c);
    }
  }
  return Array.from(chars).sort().join('');
}

function ensurePyftsubsetInstalled(): void {
  const probe = spawnSync('pyftsubset', ['--help'], { stdio: 'ignore' });
  if (probe.status === 0) return;
  throw new Error(
    'pyftsubset not found. Install with: pip install fonttools brotli zopfli',
  );
}

function subsetFont(inputFont: string, outputFont: string, glyphsFile: string): void {
  const cmd = [
    inputFont,
    `--output-file=${outputFont}`,
    `--text-file=${glyphsFile}`,
    '--flavor=woff2',
    '--layout-features=*',
    '--glyph-names',
    '--symbol-cmap',
    '--legacy-cmap',
    '--notdef-glyph',
    '--notdef-outline',
    '--recommended-glyphs',
    '--name-IDs=*',
    '--name-legacy',
    '--name-languages=*',
  ];
  const run = spawnSync('pyftsubset', cmd, { stdio: 'inherit' });
  if (run.status !== 0) {
    throw new Error(`pyftsubset failed for ${inputFont}`);
  }
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const outputDirAbs = join(PROJECT_ROOT, args.outputDir);
  mkdirSync(outputDirAbs, { recursive: true });

  const glyphs = collectGlyphs();
  if (!glyphs) {
    throw new Error('No CJK glyphs found in corpus scan.');
  }
  const glyphPath = join(outputDirAbs, 'cjk-glyphs.txt');
  writeFileSync(glyphPath, glyphs, 'utf8');

  const requestedFonts = [args.scFont, args.jpFont, args.krFont].filter(Boolean);
  if (requestedFonts.length === 0) {
    // Corpus generation alone is valid for offline planning.
    // Actual subset build runs when source TTF/OTF paths are supplied.
    // eslint-disable-next-line no-console
    console.log(`CJK glyph corpus generated at ${glyphPath} (glyph count=${glyphs.length}).`);
    return;
  }

  ensurePyftsubsetInstalled();
  if (args.scFont) subsetFont(args.scFont, join(outputDirAbs, 'NotoSansSC-subset.woff2'), glyphPath);
  if (args.jpFont) subsetFont(args.jpFont, join(outputDirAbs, 'NotoSansJP-subset.woff2'), glyphPath);
  if (args.krFont) subsetFont(args.krFont, join(outputDirAbs, 'NotoSansKR-subset.woff2'), glyphPath);
  // eslint-disable-next-line no-console
  console.log(`CJK subset build complete. Corpus file: ${glyphPath}`);
}

run();
