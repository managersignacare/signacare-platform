#!/usr/bin/env tsx
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const ASSETS_DIR = resolve(ROOT, 'apps', 'web', 'dist', 'assets');
const KiB = 1024;

type Budget = {
  label: string;
  matcher: RegExp;
  maxKiB: number;
  required: boolean;
};

const budgets: Budget[] = [
  {
    label: 'largest JS chunk',
    matcher: /\.js$/,
    maxKiB: 500,
    required: true,
  },
  {
    label: 'PatientDetailPage route shell',
    matcher: /^PatientDetailPage-.*\.js$/,
    maxKiB: 120,
    required: true,
  },
  {
    label: 'ReportsPage route shell',
    matcher: /^ReportsPage-.*\.js$/,
    maxKiB: 120,
    required: true,
  },
  {
    label: 'AdminReportWorkbench lazy chunk',
    matcher: /^AdminReportWorkbench-.*\.js$/,
    maxKiB: 380,
    required: true,
  },
];

if (!existsSync(ASSETS_DIR)) {
  console.error('Web bundle budget failed: apps/web/dist/assets is missing. Run `npm run build --workspace=apps/web` first.');
  process.exit(1);
}

const assets = readdirSync(ASSETS_DIR)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({
    name,
    sizeBytes: statSync(resolve(ASSETS_DIR, name)).size,
  }));

const violations: string[] = [];

for (const budget of budgets) {
  const matches = assets.filter((asset) => budget.matcher.test(asset.name));
  if (budget.required && matches.length === 0) {
    violations.push(`${budget.label}: required chunk not found`);
    continue;
  }

  const candidate = matches.reduce<typeof matches[number] | null>(
    (largest, asset) => (largest == null || asset.sizeBytes > largest.sizeBytes ? asset : largest),
    null,
  );
  if (!candidate) continue;

  const sizeKiB = candidate.sizeBytes / KiB;
  if (sizeKiB > budget.maxKiB) {
    violations.push(
      `${budget.label}: ${candidate.name} is ${sizeKiB.toFixed(2)} KiB, budget ${budget.maxKiB} KiB`,
    );
  }
}

if (violations.length > 0) {
  console.error('Web bundle budget failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

const largest = assets.reduce<typeof assets[number] | null>(
  (current, asset) => (current == null || asset.sizeBytes > current.sizeBytes ? asset : current),
  null,
);
console.log(
  `Web bundle budget passed. Largest JS chunk: ${largest?.name ?? 'none'} (${(((largest?.sizeBytes ?? 0) / KiB)).toFixed(2)} KiB).`,
);
