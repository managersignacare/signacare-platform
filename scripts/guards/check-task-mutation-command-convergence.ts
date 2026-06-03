/**
 * Guard: task mutation command convergence.
 *
 * Enforces a single mutation-orchestration path for tasks so writes do not
 * drift back into scattered route-level inserts/updates/deletes.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, relative } from 'path'

const ROOT = resolve(__dirname, '..', '..')

const TASK_SERVICE_FILE = resolve(ROOT, 'apps/api/src/features/tasks/taskService.ts')
const FEATURES_ROOT = resolve(ROOT, 'apps/api/src/features')

const ALLOWED_DIRECT_MUTATION_FILES = new Set([
  resolve(ROOT, 'apps/api/src/features/tasks/taskRepository.ts'),
  resolve(ROOT, 'apps/api/src/features/workflows/workflowEngine.ts'),
])

type Violation = {
  file: string
  reason: string
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, '')
}

function listFeatureTsFiles(dir: string): string[] {
  const output: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      output.push(...listFeatureTsFiles(full))
      continue
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      output.push(full)
    }
  }
  return output
}

function runGuard(): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = []

  const serviceSource = stripComments(readFileSync(TASK_SERVICE_FILE, 'utf8'))
  if (!serviceSource.includes('./taskMutationCommand')) {
    violations.push({
      file: relative(ROOT, TASK_SERVICE_FILE),
      reason: 'Task service must import taskMutationCommand.',
    })
  }
  for (const requiredCall of [
    'executeTaskCreateMutation(',
    'executeTaskUpdateMutation(',
    'executeTaskDeleteMutation(',
  ]) {
    if (!serviceSource.includes(requiredCall)) {
      violations.push({
        file: relative(ROOT, TASK_SERVICE_FILE),
        reason: `Task service must call ${requiredCall}`,
      })
    }
  }
  for (const forbiddenCall of [
    'taskRepo.create(',
    'taskRepo.createAdmin(',
    'taskRepo.update(',
    'taskRepo.hardDelete(',
  ]) {
    if (serviceSource.includes(forbiddenCall)) {
      violations.push({
        file: relative(ROOT, TASK_SERVICE_FILE),
        reason: `Direct repository mutation call is forbidden: ${forbiddenCall}`,
      })
    }
  }

  for (const file of listFeatureTsFiles(FEATURES_ROOT)) {
    if (ALLOWED_DIRECT_MUTATION_FILES.has(file)) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    const directMutationPattern = /(db|dbAdmin)\('tasks'\)\s*\.\s*(insert|update|delete)\s*\(/
    if (directMutationPattern.test(source)) {
      violations.push({
        file: relative(ROOT, file),
        reason: "Direct db('tasks').insert/update/delete is forbidden outside taskRepository/workflowEngine.",
      })
    }
  }

  return { ok: violations.length === 0, violations }
}

function main(): number {
  const result = runGuard()
  if (!result.ok) {
    console.error('✗ Task mutation command convergence guard failed:')
    for (const violation of result.violations) {
      console.error(`  - ${violation.file}: ${violation.reason}`)
    }
    return 1
  }

  console.log('✓ task mutation command convergence guard passed.')
  return 0
}

if (require.main === module) {
  process.exit(main())
}
