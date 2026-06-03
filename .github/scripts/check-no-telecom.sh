#!/usr/bin/env bash
#
# check-no-telecom.sh — enforce the WebSocket-discipline delivery policy.
#
# Phase 10F of the multi-specialty plan (see
# /Users/.../plans/sleepy-roaming-meteor.md Phase 10) locks in a
# strict rule: staff notifications and inter-staff messaging flow
# through in-app push (Server-Sent Events on web, FCM on mobile —
# Phase 11) and durable in-app records only. Telecom SMS, voice
# gateways, Twilio, MessageBird, Vonage and @azure/communication-*
# are OUT of the delivery matrix except for two surgical exemptions:
#
#   1. apps/api/src/integrations/escript/**  — regulated ETP2 eRx
#      prescription token delivery to pharmacy gateways (MySL / eRx).
#      Not a patient notification path; dictated by the prescribing
#      regulation, must not change.
#
#   2. apps/api/src/integrations/acs/**      — Phase 12's ACS SMS
#      fallback for patients without the Viva app. Used ONLY by
#      patientOutreachService. Every other file that tries to import
#      from this directory must be rejected. A second guard (not yet
#      implemented; tracked under Phase 12D) will enforce the caller
#      containment rule.
#
# This guard runs in CI alongside check-naming-conventions.sh and
# check-fix-registry.sh. Exit code 0 on clean, 1 on any violation.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

declare -i total_violations=0

# ─── Rule 1: forbidden telecom library imports ────────────────────────────────
#
# Flags `import … from 'twilio'`, 'messagebird', 'vonage',
# '@azure/communication-sms' and friends, anywhere except the two
# allowlisted integration directories.
echo "→ Rule 1: forbidden telecom / ACS imports"
violations_imports=$(
  git grep -nE "from ['\"]twilio['\"]|from ['\"]messagebird['\"]|from ['\"]vonage['\"]|from ['\"]@azure/communication-" -- \
    'apps/api/src/**/*.ts' 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'packages/**/*.ts' 2>/dev/null \
    | grep -v "apps/api/src/integrations/escript/" \
    | grep -v "apps/api/src/integrations/acs/" \
    | grep -v "// eslint-disable" \
    || true
)
if [ -n "$violations_imports" ]; then
  echo "::error::Forbidden telecom library imports found (see .github/scripts/check-no-telecom.sh for the exemption list):"
  echo "$violations_imports" | sed 's/^/    /'
  total_violations+=1
fi

# ─── Rule 2: forbidden job-queue names ────────────────────────────────────────
#
# Matches literal `addJob('sms', …)` / `enqueue('sms', …)` / the
# equivalent double-quoted form. The runtime jobBus allowlist
# (apps/api/src/shared/jobBus.ts §ALLOWED_QUEUES) throws at
# enqueue time if somehow this slips through; the CI guard is the
# earlier signal so the failure mode is "CI red on a PR" rather
# than "cron dies at 03:00 in production."
echo "→ Rule 2: forbidden 'sms' job-queue names"
# Comment-line exemption: strip lines whose content (after file:line:)
# starts with `//` or ` *` — those are doc-comment mentions of the
# forbidden pattern, not actual call sites. Leading whitespace before
# the comment prefix is tolerated.
violations_queue=$(
  git grep -nE "(addJob|enqueue)\(['\"]sms['\"]" -- \
    'apps/api/src/**/*.ts' 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 2>/dev/null \
    | grep -v "apps/api/src/integrations/escript/" \
    | grep -v "apps/api/src/integrations/acs/" \
    | grep -vE "^[^:]*:[0-9]+: *(//|\*)" \
    || true
)
if [ -n "$violations_queue" ]; then
  echo "::error::Forbidden addJob('sms', …) call sites found. Patient-destined SMS must go through the 'patient-outreach' dispatcher queue (Phase 12B). The raw 'sms' queue name is not in ALLOWED_QUEUES and will throw at runtime:"
  echo "$violations_queue" | sed 's/^/    /'
  total_violations+=1
fi

# ─── Rule 3: forbidden identifier — sendSms DECLARED outside the allowlist ───
#
# Matches only declaration forms:
#   - `function sendSms(`
#   - `async function sendSms(`
#   - `const sendSms =`, `let sendSms =`, `var sendSms =`
#   - `sendSms: async` / `sendSms: function` (property on a class or
#     object literal)
#   - `async sendSms(` / `sendSms(` as a class/object method header
#     (anchored on start-of-line whitespace so we don't catch call
#     expressions like `const r = await sendSms({...})`)
# This catches a contributor trying to DEFINE a new SMS helper outside
# integrations/acs/** or integrations/escript/**. The dispatcher in
# apps/api/src/features/patient-outreach/patientOutreachService.ts is
# allowed to CALL sendSms (that's what the Phase 12D acs-callers
# guard allowlists) — it just must not redeclare one.
echo "→ Rule 3: sendSms DECLARATIONS outside allowlisted integration dirs"
violations_identifier=$(
  git grep -nE "(function sendSms\(|const sendSms ?=|let sendSms ?=|var sendSms ?=|sendSms ?: ?(async|function)|^ +(async )?sendSms ?\()" -- \
    'apps/api/src/**/*.ts' 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 2>/dev/null \
    | grep -v "apps/api/src/integrations/escript/" \
    | grep -v "apps/api/src/integrations/acs/" \
    | grep -v ".test.ts" \
    | grep -v "// eslint-disable" \
    || true
)
if [ -n "$violations_identifier" ]; then
  echo "::error::sendSms identifier found outside integrations/acs/** and integrations/escript/**:"
  echo "$violations_identifier" | sed 's/^/    /'
  total_violations+=1
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
if [ "$total_violations" -gt 0 ]; then
  echo "::error::no-telecom guard failed with $total_violations rule(s) violated."
  echo
  echo "Background: Phase 10F of the Signacare delivery-discipline policy."
  echo "Staff notifications use SSE + FCM only. Patient SMS (when the patient"
  echo "has no Viva app) flows through the Phase 12 patient-outreach dispatcher,"
  echo "which imports ACS from apps/api/src/integrations/acs/** exclusively."
  echo "eRx token delivery (integrations/escript/**) is a regulated exemption."
  echo "See docs/fix-registry.md §NO-SMS for the full rationale."
  exit 1
fi

echo "no-telecom guard passed."
