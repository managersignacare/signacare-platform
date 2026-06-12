import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ErrorIcon from '@mui/icons-material/Error';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ShieldIcon from '@mui/icons-material/Shield';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import {
  buildNoteText,
  ConfidenceBadge,
  QUESTGradeBadge,
  RiskBanner,
  RiskLevelChip,
  SafetyAlertsBanner,
  VerifiedMedRow,
} from './ambientRecorderViewParts';
import { isDegradedAmbientResult } from './ambientRecorderResultUtils';

// Full Whisper-large language display map for bilingual/interpreter output.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  af: 'Afrikaans',
  sq: 'Albanian',
  am: 'Amharic',
  ar: 'Arabic',
  hy: 'Armenian',
  as: 'Assamese',
  az: 'Azerbaijani',
  ba: 'Bashkir',
  eu: 'Basque',
  be: 'Belarusian',
  bn: 'Bengali',
  bs: 'Bosnian',
  br: 'Breton',
  bg: 'Bulgarian',
  my: 'Burmese',
  ca: 'Catalan',
  zh: 'Chinese',
  hr: 'Croatian',
  cs: 'Czech',
  da: 'Danish',
  nl: 'Dutch',
  et: 'Estonian',
  fo: 'Faroese',
  fil: 'Filipino',
  fi: 'Finnish',
  fr: 'French',
  gl: 'Galician',
  ka: 'Georgian',
  de: 'German',
  el: 'Greek',
  gu: 'Gujarati',
  ht: 'Haitian Creole',
  ha: 'Hausa',
  haw: 'Hawaiian',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  is: 'Icelandic',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  jv: 'Javanese',
  kn: 'Kannada',
  kk: 'Kazakh',
  km: 'Khmer',
  ko: 'Korean',
  lo: 'Lao',
  la: 'Latin',
  lv: 'Latvian',
  ln: 'Lingala',
  lt: 'Lithuanian',
  lb: 'Luxembourgish',
  mk: 'Macedonian',
  mg: 'Malagasy',
  ms: 'Malay',
  ml: 'Malayalam',
  mt: 'Maltese',
  mi: 'Maori',
  mr: 'Marathi',
  mn: 'Mongolian',
  ne: 'Nepali',
  no: 'Norwegian',
  nn: 'Norwegian Nynorsk',
  oc: 'Occitan',
  ps: 'Pashto',
  fa: 'Persian/Dari',
  pl: 'Polish',
  pt: 'Portuguese',
  pa: 'Punjabi',
  ro: 'Romanian',
  ru: 'Russian',
  sa: 'Sanskrit',
  sr: 'Serbian',
  sn: 'Shona',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  so: 'Somali',
  es: 'Spanish',
  su: 'Sundanese',
  sw: 'Swahili',
  sv: 'Swedish',
  tl: 'Tagalog',
  tg: 'Tajik',
  ta: 'Tamil',
  tt: 'Tatar',
  te: 'Telugu',
  th: 'Thai',
  bo: 'Tibetan',
  tr: 'Turkish',
  tk: 'Turkmen',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  vi: 'Vietnamese',
  cy: 'Welsh',
  yi: 'Yiddish',
  yo: 'Yoruba',
};

interface AmbientAiResultPanelProps {
  result: AmbientNoteResult;
  showResult: boolean;
  resultTab: number;
  onResultTabChange: (tab: number) => void;
  onCollapse: () => void;
  onUseNote: (noteText: string) => void;
}

function buildTabs(result: AmbientNoteResult): Array<{ label: string; key: string }> {
  const tabs: Array<{ label: string; key: string }> = [
    { label: 'Structured Note', key: 'note' },
    { label: result.diarizedTranscript ? 'Diarized Transcript' : 'Transcript', key: 'transcript' },
  ];
  if (result.safetyAlerts?.length || result.riskAssessment) tabs.push({ label: 'Safety & Risk', key: 'safety' });
  if (result.mentalStateExam || result.mseStructured) tabs.push({ label: 'MSE', key: 'mse' });
  if (result.verifiedMedications?.length) tabs.push({ label: 'Medications', key: 'meds' });
  if (result.icd10Suggestions?.length || result.mbsSuggestions?.length) tabs.push({ label: 'Coding', key: 'coding' });
  if (result.scribeActions?.length) tabs.push({ label: 'Actions', key: 'actions' });
  if (result.outcomeMeasures?.length) tabs.push({ label: 'Outcome Measures', key: 'outcomes' });
  if (result.bilingualTranscript) tabs.push({ label: 'Bilingual Transcript', key: 'bilingual' });
  if (result.extractedFacts) tabs.push({ label: 'Extracted Facts', key: 'facts' });
  return tabs;
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

export function AmbientAiResultPanel({
  result,
  showResult,
  resultTab,
  onResultTabChange,
  onCollapse,
  onUseNote,
}: AmbientAiResultPanelProps) {
  const tabs = buildTabs(result);
  const activeTab = tabs[resultTab]?.key;
  const degraded = isDegradedAmbientResult(result);

  return (
    <Collapse in={showResult}>
      <Paper variant="outlined" sx={{ mt: 2, p: 2, borderColor: '#327C8D' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalHospitalIcon sx={{ color: '#327C8D', fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={700}>Medical-Grade Clinical Note</Typography>
            <Chip label="Requires Clinician Review" size="small" sx={{ fontSize: 10, bgcolor: '#FFF3E0', color: '#E65100' }} />
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            {result.quality && <ConfidenceBadge confidence={result.quality.overallConfidence} />}
            <Tooltip title={degraded ? 'Review-only AI output cannot be copied as note content' : 'Copy to clipboard'}>
              <IconButton size="small" aria-label="Copy to clipboard" disabled={degraded} onClick={() => copyToClipboard(buildNoteText(result))}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton size="small" aria-label="Collapse result" onClick={onCollapse}>
              <ExpandLessIcon />
            </IconButton>
          </Box>
        </Box>

        {degraded && (
          <Alert role="alert" severity="warning" sx={{ mb: 1.5, fontSize: 12 }}>
            AI output was generated in degraded review-only mode. Use the transcript/manual-note workflow; this draft cannot be inserted into the clinical note.
          </Alert>
        )}

        {result.safetyAlerts && result.safetyAlerts.length > 0 && (
          <SafetyAlertsBanner alerts={result.safetyAlerts} />
        )}

        {result.riskAssessment && result.riskAssessment.overallLevel !== 'low' && (
          <RiskBanner riskAssessment={result.riskAssessment} />
        )}

        {!result.riskAssessment && result.riskFlags.length > 0 && (
          <Alert role="alert" severity="warning" sx={{ mb: 1.5, fontSize: 12 }} icon={<WarningAmberIcon />}>
            <Typography variant="caption" fontWeight={600}>Risk Flags Detected:</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {result.riskFlags.map(f => (
                <Chip key={f} label={f} size="small" color="warning" sx={{ fontSize: 10 }} />
              ))}
            </Box>
          </Alert>
        )}

        {(result.icd10Suggestions?.length ?? 0) > 0 && (
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mr: 0.5 }}>ICD-10-AM:</Typography>
            {result.icd10Suggestions!.map(d => (
              <Tooltip key={d.code} title={`${d.description} [${d.confidence}]`}>
                <Chip label={d.code} size="small" variant="outlined"
                  sx={{ fontSize: 10, fontFamily: 'monospace', borderColor: d.confidence === 'high' ? '#4CAF50' : d.confidence === 'moderate' ? '#b8621a' : '#999' }} />
              </Tooltip>
            ))}
          </Box>
        )}

        {!(result.icd10Suggestions?.length) && result.suggestedDiagnosis.length > 0 && (
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>ICD-10-AM:</Typography>
            {result.suggestedDiagnosis.map(d => (
              <Chip key={d} label={d} size="small" variant="outlined" sx={{ fontSize: 10, fontFamily: 'monospace' }} />
            ))}
          </Box>
        )}

        {result.questScore && (
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <QUESTGradeBadge grade={result.questScore.grade} score={result.questScore.overall} />
            {result.questScore.issues.length > 0 && (
              <Tooltip title={result.questScore.issues.join('\n')}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, cursor: 'help', textDecoration: 'underline dotted' }}>
                  {result.questScore.issues.length} issue{result.questScore.issues.length > 1 ? 's' : ''} found
                </Typography>
              </Tooltip>
            )}
          </Box>
        )}

        {result.quality && (
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, minWidth: 75 }}>
              Evidence: {result.quality.sectionsWithEvidence}/{result.quality.sectionsTotal}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={result.quality.overallConfidence}
              sx={{
                flex: 1, height: 6, borderRadius: 3,
                bgcolor: '#f0ebe4',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 3,
                  bgcolor: result.quality.overallConfidence > 70 ? '#4CAF50'
                    : result.quality.overallConfidence > 40 ? '#b8621a' : '#D32F2F',
                },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, minWidth: 50 }}>
              {result.quality.transcriptWordCount} words
            </Typography>
          </Box>
        )}

        <Tabs aria-label="Navigation tabs" value={resultTab} onChange={(_, v) => onResultTabChange(v)}
          sx={{ mb: 1, minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: 12, textTransform: 'none' } }}>
          {tabs.map(t => <Tab key={t.key} label={t.label} />)}
        </Tabs>

        {activeTab === 'note' && (
          <Grid container spacing={1.5}>
            {(['subjective', 'objective', 'assessment', 'plan'] as const).map(section => (
              <Grid key={section} size={{ xs: 12, md: 6 }}>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ textTransform: 'uppercase', fontSize: 10 }}>
                  {section}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', mt: 0.25 }}>
                  {result.structured[section] || '-'}
                </Typography>
              </Grid>
            ))}
          </Grid>
        )}

        {activeTab === 'transcript' && (
          <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
            <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {(result.diarizedTranscript || result.transcript).split('\n').map((line, i) => {
                const isClinician = line.startsWith('[CLINICIAN]');
                const isPatient = line.startsWith('[PATIENT]');
                return (
                  <Box key={i} sx={{ mb: 1, pl: isPatient ? 2 : 0 }}>
                    {isClinician && (
                      <Chip label="Clinician" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#327C8D20', color: '#327C8D', fontWeight: 700, mr: 0.5 }} />
                    )}
                    {isPatient && (
                      <Chip label="Patient" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#b8621a20', color: '#b8621a', fontWeight: 700, mr: 0.5 }} />
                    )}
                    <span style={{ fontStyle: isPatient ? 'italic' : 'normal' }}>
                      {line.replace(/^\[(CLINICIAN|PATIENT)\]:\s*/, '')}
                    </span>
                  </Box>
                );
              })}
            </Typography>
          </Box>
        )}

        {activeTab === 'safety' && (
          <Box>
            {result.riskAssessment && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  RISK ASSESSMENT
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="body2" sx={{ fontSize: 12 }}>Overall level:</Typography>
                  <RiskLevelChip level={result.riskAssessment.overallLevel} />
                </Box>
                {result.riskAssessment.flags.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    {result.riskAssessment.flags.map((f, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'flex-start' }}>
                        <RiskLevelChip level={f.severity} />
                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{f.flag}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{f.evidence}</Typography>
                          <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: '#1565C0', mt: 0.25 }}>
                            Action: {f.action}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
                {result.riskAssessment.protectiveFactors.length > 0 && (
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11, color: '#2E7D32' }}>Protective factors:</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {result.riskAssessment.protectiveFactors.map(f => (
                        <Chip key={f} label={f} size="small" sx={{ fontSize: 10, bgcolor: '#E8F5E9', color: '#2E7D32' }} />
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            )}

            {result.safetyAlerts && result.safetyAlerts.length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  SAFETY ALERTS
                </Typography>
                {result.safetyAlerts.map((a, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                    {a.severity === 'critical' ? <ErrorIcon sx={{ fontSize: 16, color: '#D32F2F' }} />
                      : a.severity === 'warning' ? <WarningAmberIcon sx={{ fontSize: 16, color: '#ED6C02' }} />
                      : <ShieldIcon sx={{ fontSize: 16, color: '#1565C0' }} />}
                    <Chip label={a.type.replace('_', ' ')} size="small" sx={{ fontSize: 9, height: 18 }} />
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{a.message}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {activeTab === 'mse' && (result.mentalStateExam || result.mseStructured) && (
          <Grid container spacing={1}>
            {!result.mseStructured && Object.entries(result.mentalStateExam ?? {}).map(([key, val]) => (
              <Grid key={key} size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'capitalize', fontSize: 10, color: '#327C8D' }}>
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 12, color: val ? 'text.primary' : 'text.disabled' }}>
                  {val || 'Not assessed'}
                </Typography>
              </Grid>
            ))}
            {result.mseStructured && Object.entries(result.mseStructured.domains).map(([key, domain]) => {
              if (!domain) return null;
              return (
                <Grid key={`structured-${key}`} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Paper variant="outlined" sx={{ p: 1, height: '100%', bgcolor: '#fffdf8', borderColor: '#eadfce' }}>
                    <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'capitalize', fontSize: 10, color: '#327C8D' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 12, color: domain.certainty === 'not_assessed' ? 'text.disabled' : 'text.primary' }}>
                      {domain.finding}
                    </Typography>
                    <Chip label={domain.certainty.replace('_', ' ')} size="small" sx={{ mt: 0.75, mr: 0.5, height: 18, fontSize: 9 }} />
                    {domain.citations.map((citation, i) => (
                      <Typography key={`${key}-citation-${i}`} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, fontSize: 10 }}>
                        Evidence: {citation.excerpt}
                      </Typography>
                    ))}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}

        {activeTab === 'meds' && result.verifiedMedications && (
          <Box>
            {result.verifiedMedications.map((med, i) => (
              <VerifiedMedRow key={i} med={med} />
            ))}
          </Box>
        )}

        {activeTab === 'coding' && (
          <Box>
            {result.icd10Suggestions && result.icd10Suggestions.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  ICD-10-AM DIAGNOSIS CODES
                </Typography>
                {result.icd10Suggestions.map((s, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                    <Chip label={s.code} size="small" sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, minWidth: 55,
                      bgcolor: s.confidence === 'high' ? '#E8F5E9' : s.confidence === 'moderate' ? '#FFF3E0' : '#F5F5F5',
                      color: s.confidence === 'high' ? '#2E7D32' : s.confidence === 'moderate' ? '#E65100' : '#666' }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{s.description}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Source: {s.source.substring(0, 80)}</Typography>
                    </Box>
                    <Chip label={s.confidence} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                  </Box>
                ))}
              </Box>
            )}
            {result.mbsSuggestions && result.mbsSuggestions.length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  MBS ITEM SUGGESTIONS
                </Typography>
                {result.mbsSuggestions.map((s, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                    <Chip label={s.itemNumber} size="small" sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{s.description}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{s.criteria}</Typography>
                    </Box>
                    <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11, color: '#2E7D32' }}>{s.fee}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {activeTab === 'actions' && result.scribeActions && (
          <Box>
            <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
              SUGGESTED ACTIONS FROM NOTE
            </Typography>
            {result.scribeActions.map((a, i) => {
              const iconColors: Record<string, string> = {
                referral: '#7B5EA7',
                appointment: '#1565C0',
                prescription: '#b8621a',
                pathology: '#2E7D32',
                task: '#327C8D',
                alert: '#D32F2F',
              };
              return (
                <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                  <Chip label={a.type} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: `${iconColors[a.type] ?? '#999'}15`, color: iconColors[a.type] ?? '#999', fontWeight: 700, textTransform: 'capitalize' }} />
                  <Typography variant="body2" sx={{ fontSize: 12, flex: 1 }}>{a.description}</Typography>
                  {a.autoCreateable && (
                    <Chip label="Auto-create" size="small" variant="outlined" sx={{ fontSize: 9, height: 18, color: '#2E7D32', borderColor: '#2E7D32' }} />
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {activeTab === 'outcomes' && result.outcomeMeasures && (
          <Box>
            <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
              EXTRACTED OUTCOME MEASURES
            </Typography>
            {result.outcomeMeasures.map((m, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                <Chip label={m.instrument} size="small" sx={{ fontSize: 10, fontWeight: 700, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                <Typography variant="body2" fontWeight={700} sx={{ fontSize: 14 }}>{m.score}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>/ {m.maxScore}</Typography>
                <Chip label={m.severity} size="small" sx={{ fontSize: 9, height: 18,
                  bgcolor: m.severity === 'Severe' || m.severity === 'Extremely severe' ? '#FFEBEE' : m.severity === 'Moderate' || m.severity === 'Moderately severe' ? '#FFF3E0' : '#E8F5E9',
                  color: m.severity === 'Severe' || m.severity === 'Extremely severe' ? '#D32F2F' : m.severity === 'Moderate' || m.severity === 'Moderately severe' ? '#E65100' : '#2E7D32',
                  fontWeight: 600 }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, flex: 1 }}>{m.evidence.substring(0, 60)}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {activeTab === 'bilingual' && result.bilingualTranscript && (
          <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
            {result.interpreterUsed && (
              <Alert severity="info" sx={{ mb: 1, fontSize: 11, py: 0.5 }} icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}>
                Interpreter-assisted consultation{result.interpreterLanguage ? ` (${LANGUAGE_NAMES[result.interpreterLanguage] ?? result.interpreterLanguage})` : ''}. Non-English segments auto-translated to English.
              </Alert>
            )}
            {result.bilingualTranscript.split('\n').map((line, i) => {
              const isTranslation = line.trimStart().startsWith('→');
              const isSpeakerLine = line.startsWith('[');
              return (
                <Typography key={i} variant="body2" sx={{
                  fontSize: 12, whiteSpace: 'pre-wrap', mb: isTranslation ? 0.75 : 0.25,
                  pl: isTranslation ? 3 : 0,
                  color: isTranslation ? '#1565C0' : isSpeakerLine ? 'text.primary' : 'text.secondary',
                  fontStyle: isTranslation ? 'italic' : 'normal',
                  fontWeight: isSpeakerLine ? 600 : 400,
                }}>
                  {line}
                </Typography>
              );
            })}
          </Box>
        )}

        {activeTab === 'facts' && result.extractedFacts && (
          <Grid container spacing={1.5}>
            {Object.entries(result.extractedFacts).filter(([k, v]) => k !== 'mse' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)).map(([key, facts]) => {
              const tagColors: Record<string, string> = {
                subjective: '#327C8D',
                objective: '#b8621a',
                assessment: '#7B5EA7',
                plan: '#2E7D32',
                risk: '#D32F2F',
                medications: '#1565C0',
                quotes: '#6D4C41',
              };
              const items = Array.isArray(facts) ? facts : Object.entries(facts).map(([k, v]) => `${k}: ${v}`);
              return (
                <Grid key={key} size={{ xs: 12, sm: 6 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tagColors[key] || '#999' }} />
                    <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', fontSize: 10, color: tagColors[key] }}>
                      {key} ({items.length})
                    </Typography>
                  </Box>
                  {items.map((f: string, j: number) => (
                    <Typography key={j} variant="body2" sx={{ fontSize: 11, pl: 1.5, mb: 0.25, borderLeft: `2px solid ${tagColors[key]}22` }}>
                      {f}
                    </Typography>
                  ))}
                </Grid>
              );
            })}
          </Grid>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" startIcon={<EditNoteIcon />}
            disabled={degraded}
            onClick={() => onUseNote(buildNoteText(result))}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 11, textTransform: 'none' }}>
            {degraded ? 'Review-only output' : 'Use in Note'}
          </Button>
          <Chip
            icon={<LocalHospitalIcon sx={{ fontSize: 12 }} />}
            label="Medical-Grade 3-Pass"
            size="small"
            sx={{ fontSize: 9, height: 18, bgcolor: '#327C8D15', color: '#327C8D', fontWeight: 600 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            {result.durationSeconds}s total
            {result.transcriptionDurationMs ? ` (Whisper: ${(result.transcriptionDurationMs / 1000).toFixed(1)}s` : ''}
            {result.pass1DurationMs ? ` | Extract: ${(result.pass1DurationMs / 1000).toFixed(1)}s` : ''}
            {result.pass2DurationMs ? ` | Safety: ${(result.pass2DurationMs / 1000).toFixed(1)}s` : ''}
            {result.pass3DurationMs ? ` | Format: ${(result.pass3DurationMs / 1000).toFixed(1)}s)` : ''}
            {' | '}{result.model}
          </Typography>
        </Box>
      </Paper>
    </Collapse>
  );
}
