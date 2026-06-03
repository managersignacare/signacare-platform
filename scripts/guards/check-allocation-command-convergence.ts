/**
 * Guard: allocation orchestration convergence.
 *
 * Ensures planned-transition execution and reallocation approval use the
 * shared allocation execution command instead of drifting into parallel
 * orchestration paths.
 */

import { readFileSync } from 'fs'
import { resolve, relative } from 'path'

const ROOT = resolve(__dirname, '..', '..')

const TARGETS = [
  {
    file: resolve(ROOT, 'apps/api/src/features/staff-settings/staffTransitionCommands.ts'),
    importNeedle: '../patients/allocationExecutionCommand',
  },
  {
    file: resolve(ROOT, 'apps/api/src/features/reallocations/reallocationService.ts'),
    importNeedle: '../patients/allocationExecutionCommand',
  },
] as const

type Violation = {
  file: string
  reason: string
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, '')
}

function runGuard(): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = []

  for (const target of TARGETS) {
    const raw = readFileSync(target.file, 'utf8')
    const source = stripComments(raw)
    const file = relative(ROOT, target.file)

    if (!source.includes(target.importNeedle)) {
      violations.push({
        file,
        reason: 'Missing shared allocation execution command import.',
      })
    }

    if (!source.includes('executeAllocationInstructions(')) {
      violations.push({
        file,
        reason: 'Must execute allocation writes via executeAllocationInstructions().',
      })
    }

    if (source.includes('applyPatientAllocationMutation(')) {
      violations.push({
        file,
        reason: 'Direct applyPatientAllocationMutation() call is forbidden in orchestration modules.',
      })
    }
  }

  return { ok: violations.length === 0, violations }
}

function main(): number {
  const result = runGuard()
  if (!result.ok) {
    console.error('✗ Allocation orchestration convergence guard failed:')
    for (const violation of result.violations) {
      console.error(`  - ${violation.file}: ${violation.reason}`)
    }
    return 1
  }

  console.log('✓ allocation orchestration convergence guard passed.')
  return 0
}

if (require.main === module) {
  process.exit(main())
}
