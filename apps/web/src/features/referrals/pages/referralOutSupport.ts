export type ReferralOutTargetType =
  | 'internal_team'
  | 'existing_provider'
  | 'new_provider'

export interface ReferralOutLetterInput {
  patientDisplayName: string
  patientUrNumber?: string | null
  patientDateOfBirth?: string | null
  targetRecipient: string
  targetType: ReferralOutTargetType
  reason: string
  diagnosisSummary?: string[]
  medicationSummary?: string[]
  additionalClinicalSummary?: string | null
  generatedAt?: Date
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return date.toLocaleDateString('en-AU')
}

function lineList(values: string[] | undefined, fallback: string): string {
  if (!values || values.length === 0) return fallback
  return values.map((value) => `- ${value}`).join('\n')
}

function destinationLabel(targetType: ReferralOutTargetType): string {
  if (targetType === 'internal_team') return 'Internal Team / Program'
  if (targetType === 'existing_provider') return 'Existing Provider / Service'
  return 'New Provider / Health Service'
}

export function buildReferralOutLetterDraft(input: ReferralOutLetterInput): string {
  const generatedAt = input.generatedAt ?? new Date()
  const reason = input.reason.trim() || 'Clinical referral requested'
  const diagnosisBlock = lineList(input.diagnosisSummary, '- No diagnosis recorded yet')
  const medicationBlock = lineList(input.medicationSummary, '- No active medications recorded')
  const clinicalSummary = input.additionalClinicalSummary?.trim() || 'Please refer to attached progress notes for additional context.'

  return [
    `Date: ${generatedAt.toLocaleDateString('en-AU')}`,
    '',
    `To: ${input.targetRecipient}`,
    `${destinationLabel(input.targetType)}`,
    '',
    'Re: Outbound Referral',
    `Patient: ${input.patientDisplayName}`,
    `UR Number: ${input.patientUrNumber ?? 'Not recorded'}`,
    `Date of Birth: ${formatDate(input.patientDateOfBirth)}`,
    '',
    'Reason for Referral',
    reason,
    '',
    'Current Clinical Summary',
    clinicalSummary,
    '',
    'Diagnoses',
    diagnosisBlock,
    '',
    'Current Medications',
    medicationBlock,
    '',
    'Kind regards,',
    '[Clinician Name]',
    '[Role]',
    '[Clinic]',
  ].join('\n')
}
