import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
  Tab, Tabs, TextField, Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import {
  llmModelfilesKeys,
  llmModelfileKeys,
  llmTrainingStatsKeys,
  llmTrainingAdaptersKeys,
  llmPromptProfilesKeys,
  staffSettingsAiContextKeys,
} from '../queryKeys';

const ACTION_TYPES = [
  { value: 'ambient', label: 'Ambient Scribe' },
  { value: 'maudsley', label: 'Clinical Summary (Maudsley)' },
  { value: 'isbar', label: 'ISBAR Handover' },
  { value: 'formulation', label: 'Biopsychosocial Formulation' },
  { value: '91day', label: '91-Day Review' },
  { value: 'letter', label: 'Professional Letter' },
  { value: 'discharge', label: 'Discharge Summary' },
  { value: 'med-summary', label: 'Medication Summary' },
  { value: 'risk-summary', label: 'Risk Summary' },
  { value: 'linkages', label: 'Linkages Summary' },
];

type InnerTab = 'modelfile' | 'rag' | 'finetune' | 'stats';

type ModelfileSummaryRow = {
  actionType?: string;
  action_type?: string;
};

type ModelfileDetailRow = {
  systemPrompt?: string;
  system_prompt?: string;
  modelName?: string;
  model_name?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
  modelfileContent?: string;
  modelfile_content?: string;
};

type AiContextFileRow = {
  id?: string;
  title?: string;
  category?: string;
  priority?: string;
  isActive?: boolean;
  is_active?: boolean;
  tokenEstimate?: number;
  token_estimate?: number;
};

type RagTestContextFileRow = {
  relevanceScore?: number;
  title?: string;
  tokenEstimate?: number;
  token_estimate?: number;
};

type RagTestResult = {
  query?: string;
  contextFiles?: RagTestContextFileRow[];
  policies?: unknown[];
  totalTokenEstimate?: number;
  error?: string;
};

type TriggerResult = {
  modelName?: string;
  error?: string;
};

type TrainingStatsByActionRow = {
  action?: string;
  total?: number;
  edited?: number;
  avgRating?: number | string;
};

type TrainingStatsResponse = {
  totalFeedback?: number;
  readyForTraining?: number;
  edited?: number;
  avgRating?: number | string;
  byAction?: TrainingStatsByActionRow[];
};

type TrainingAdapterRow = {
  name?: string;
  size?: number;
  modified_at?: string;
};

type TrainingAdaptersResponse = {
  adapters?: TrainingAdapterRow[];
};

type PromptProfileRow = {
  id: string;
  title: string;
  version: string;
  modelAgnostic: boolean;
  targetActions: string[];
  purpose: string;
  governanceChecklist: string[];
};

type PromptProfilesResponse = {
  version?: string;
  profiles?: PromptProfileRow[];
};

type PromptProfilesApplyResponse = {
  appliedProfileIds?: string[];
  upsertedActions?: number;
  manifestRowsWritten?: number;
};

const readErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export default function AiTrainingModule() {
  const [innerTab, setInnerTab] = useState<InnerTab>('modelfile');

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <AutoAwesomeIcon sx={{ color: '#7B1FA2' }} />
        <Typography variant="h6" fontWeight={600}>AI Training & Configuration</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Configure AI behaviour using the 4-level approach: System Prompts, RAG Context, Fine-tuning, and Training Analytics.
      </Typography>

      <Tabs value={innerTab} onChange={(_, v) => setInnerTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontSize: 13 } }}>
        <Tab label="Modelfile & Prompts" value="modelfile" />
        <Tab label="RAG Context" value="rag" />
        <Tab label="Fine-tuning (QLoRA/DoRA)" value="finetune" />
        <Tab label="Training Stats" value="stats" />
      </Tabs>

      {innerTab === 'modelfile' && <ModelfilePromptsTab />}
      {innerTab === 'rag' && <RagTab />}
      {innerTab === 'finetune' && <FineTuningTab />}
      {innerTab === 'stats' && <TrainingStatsTab />}
    </Box>
  );
}

// ── Sub-Tab 1: Modelfile & System Prompts ────────────────────────────────────

function ModelfilePromptsTab() {
  const qc = useQueryClient();
  const [selectedAction, setSelectedAction] = useState('ambient');
  const [editPrompt, setEditPrompt] = useState('');
  const [editModel, setEditModel] = useState('qwen2.5:14b');
  const [editTemp, setEditTemp] = useState('0.2');
  const [editMaxTokens, setEditMaxTokens] = useState('4096');
  const [editModelfile, setEditModelfile] = useState('');

  const { data: modelfiles } = useQuery({
    queryKey: llmModelfilesKeys.all,
    queryFn: () => apiClient.get<{ modelfiles: ModelfileSummaryRow[] }>('llm/modelfiles').then(r => r.modelfiles ?? []),
  });

  const { data: currentConfig } = useQuery({
    queryKey: llmModelfileKeys.detail(selectedAction),
    queryFn: () => apiClient.get<{ modelfile: ModelfileDetailRow }>(`llm/modelfiles/${selectedAction}`).then(r => r.modelfile),
  });

  const { data: promptProfiles } = useQuery({
    queryKey: llmPromptProfilesKeys.all,
    queryFn: () => apiClient.get<PromptProfilesResponse>('llm/prompt-profiles').then((r) => r.profiles ?? []),
  });

  React.useEffect(() => {
    if (currentConfig) {
      setEditPrompt(currentConfig.systemPrompt ?? currentConfig.system_prompt ?? '');
      setEditModel(currentConfig.modelName ?? currentConfig.model_name ?? 'qwen2.5:14b');
      setEditTemp(String(currentConfig.temperature ?? 0.2));
      setEditMaxTokens(String(currentConfig.maxTokens ?? currentConfig.max_tokens ?? 4096));
      setEditModelfile(currentConfig.modelfileContent ?? currentConfig.modelfile_content ?? '');
    } else {
      setEditPrompt(''); setEditModelfile(''); setEditModel('qwen2.5:14b'); setEditTemp('0.2'); setEditMaxTokens('4096');
    }
  }, [currentConfig]);

  const saveMut = useMutation({
    mutationFn: () => apiClient.put(`llm/modelfiles/${selectedAction}`, {
      systemPrompt: editPrompt || undefined,
      modelName: editModel,
      temperature: parseFloat(editTemp) || 0.2,
      maxTokens: parseInt(editMaxTokens, 10) || 4096,
      modelfileContent: editModelfile || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: llmModelfilesKeys.all }); qc.invalidateQueries({ queryKey: llmModelfileKeys.detail(selectedAction) }); },
  });

  const deleteMut = useMutation({
    mutationFn: () => apiClient.delete(`llm/modelfiles/${selectedAction}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: llmModelfilesKeys.all }); qc.invalidateQueries({ queryKey: llmModelfileKeys.detail(selectedAction) }); },
  });

  const applyProfilesMut = useMutation({
    mutationFn: () => apiClient.post<PromptProfilesApplyResponse>('llm/prompt-profiles/apply', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: llmModelfilesKeys.all });
      qc.invalidateQueries({ queryKey: llmModelfileKeys.detail(selectedAction) });
      qc.invalidateQueries({ queryKey: staffSettingsAiContextKeys.all });
    },
  });

  const configuredActions = (modelfiles ?? []).map((m: ModelfileSummaryRow) => m.actionType ?? m.action_type);

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
        Enterprise prompt profile pack is model-agnostic and portable across environments. Applying it updates system prompts for diagnosis, longitudinal summary, 91-day review, and ambient scribe, and stores a manifest for export/import continuity.
      </Alert>
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '4px solid #327C8D' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.6 }}>
          Enterprise Prompt Profiles
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.2 }}>
          Derived from your DSM diagnostic synthesis, longitudinal summary, and psychiatric scribe master prompt governance.
        </Typography>
        {(promptProfiles ?? []).map((p) => (
          <Box key={p.id} sx={{ mb: 0.8, pb: 0.8, borderBottom: '1px dashed #E0E0E0' }}>
            <Typography variant="body2" fontWeight={600}>{p.title} ({p.version})</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Actions: {p.targetActions.join(', ')} | {p.modelAgnostic ? 'Model-agnostic' : 'Model-specific'}
            </Typography>
          </Box>
        ))}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Button
            variant="contained"
            size="small"
            onClick={() => applyProfilesMut.mutate()}
            disabled={applyProfilesMut.isPending}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#2A6C7C' }, textTransform: 'none' }}
          >
            {applyProfilesMut.isPending ? 'Applying...' : 'Apply Enterprise Profiles'}
          </Button>
        </Box>
        {applyProfilesMut.data && (
          <Alert severity="success" sx={{ mt: 1, fontSize: 11 }}>
            Applied {applyProfilesMut.data.appliedProfileIds?.length ?? 0} profile(s), updated {applyProfilesMut.data.upsertedActions ?? 0} action prompt(s), wrote {applyProfilesMut.data.manifestRowsWritten ?? 0} portability manifest row(s).
          </Alert>
        )}
        {applyProfilesMut.error && (
          <Alert severity="error" sx={{ mt: 1, fontSize: 11 }}>
            {readErrorMessage(applyProfilesMut.error, 'Failed to apply enterprise prompt profiles')}
          </Alert>
        )}
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Action Types</Typography>
            {ACTION_TYPES.map(a => {
              const isSelected = selectedAction === a.value;
              return (
              <Box key={a.value}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={a.label}
                onClick={() => setSelectedAction(a.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAction(a.value); } }}
                sx={{ p: 1, mb: 0.5, borderRadius: 1, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  bgcolor: isSelected ? '#F3E5F5' : 'transparent', '&:hover': { bgcolor: '#F5F5F5' },
                  '&:focus-visible': { outline: '2px solid #7B1FA2', outlineOffset: -2 } }}>
                <Typography variant="body2" fontWeight={isSelected ? 700 : 400} sx={{ fontSize: 12 }}>{a.label}</Typography>
                {configuredActions.includes(a.value) && <Chip label="Custom" size="small" sx={{ fontSize: 8, height: 16, bgcolor: '#E8F5E9', color: '#2E7D32' }} />}
              </Box>
              );
            })}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
              {ACTION_TYPES.find(a => a.value === selectedAction)?.label ?? selectedAction}
              {currentConfig && <Chip label="Custom Override Active" size="small" sx={{ ml: 1, fontSize: 9, height: 18, bgcolor: '#E8F5E9', color: '#2E7D32' }} />}
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <FormControl fullWidth size="small"><InputLabel>Model</InputLabel>
                  <Select value={editModel} onChange={e => setEditModel(e.target.value)} label="Model">
                    <MenuItem value="qwen2.5:14b">Qwen 2.5 14B (Premium)</MenuItem>
                    <MenuItem value="llama3.2">Llama 3.2 (Fast)</MenuItem>
                    <MenuItem value="custom">Custom (from Modelfile)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 3 }}>
                <TextField label="Temperature" size="small" fullWidth type="number" value={editTemp} onChange={e => setEditTemp(e.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }} />
              </Grid>
              <Grid size={{ xs: 3 }}>
                <TextField label="Max Tokens" size="small" fullWidth type="number" value={editMaxTokens} onChange={e => setEditMaxTokens(e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField label="System Prompt" fullWidth multiline rows={8} value={editPrompt} onChange={e => setEditPrompt(e.target.value)}
                  placeholder="Enter a custom system prompt for this action. Leave blank to use the built-in default."
                  helperText="This overrides the built-in system prompt. The LLM will use this as its primary instruction." />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField label="Ollama Modelfile (Advanced)" fullWidth multiline rows={4} value={editModelfile} onChange={e => setEditModelfile(e.target.value)}
                  placeholder="FROM qwen2.5:14b&#10;PARAMETER temperature 0.2&#10;SYSTEM &quot;...&quot;"
                  helperText="Full Ollama Modelfile template. Used when triggering fine-tuning." />
              </Grid>
            </Grid>
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              {currentConfig && <Button size="small" color="error" onClick={() => { if (confirm('Revert to defaults?')) deleteMut.mutate(); }} sx={{ textTransform: 'none' }}>Revert to Default</Button>}
              <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, textTransform: 'none' }}>
                {saveMut.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

// ── Sub-Tab 2: RAG Context Management ────────────────────────────────────────

function RagTab() {
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<RagTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const { data: files } = useQuery({
    queryKey: staffSettingsAiContextKeys.all,
    queryFn: () => apiClient.get<{ files: AiContextFileRow[] }>('staff-settings/ai-context').then(r => r.files ?? []),
  });

  const activeFiles = (files ?? []).filter((f: AiContextFileRow) => f.isActive ?? f.is_active);
  const totalTokens = activeFiles.reduce((s: number, f: AiContextFileRow) => s + (f.tokenEstimate ?? f.token_estimate ?? 0), 0);

  const runTest = async () => {
    if (!testQuery.trim()) return;
    setTesting(true);
    try {
      const r = await apiClient.post<RagTestResult>('llm/rag/test-query', { query: testQuery });
      setTestResult(r);
    } catch { setTestResult({ error: 'Test failed' }); }
    setTesting(false);
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
        RAG (Retrieval-Augmented Generation) injects clinic-specific knowledge into every LLM call. Manage context files in the "AI Training Context" tab.
        Currently {activeFiles.length} active files with ~{totalTokens.toLocaleString()} tokens.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Test RAG Retrieval</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Enter a clinical query to see which context files and policies would be injected into the LLM prompt.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" fullWidth value={testQuery} onChange={e => setTestQuery(e.target.value)} placeholder="e.g. clozapine monitoring requirements" />
          <Button variant="contained" onClick={runTest} disabled={testing} sx={{ bgcolor: '#7B1FA2', textTransform: 'none', whiteSpace: 'nowrap' }}>
            {testing ? 'Testing...' : 'Test Query'}
          </Button>
        </Box>
      </Paper>

      {testResult && !testResult.error && (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#F3E5F5' }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Retrieval Results for: "{testResult.query}"</Typography>
          <Typography variant="caption" display="block" sx={{ mb: 1 }}>
            {testResult.contextFiles?.length ?? 0} context files matched | {testResult.policies?.length ?? 0} policies matched | ~{testResult.totalTokenEstimate?.toLocaleString() ?? 0} tokens
          </Typography>
          {(testResult.contextFiles ?? []).map((f: RagTestContextFileRow, i: number) => {
            const relevance = f.relevanceScore ?? 0;
            return (
              <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #E0E0E0' }}>
                <Chip label={`${Math.round(relevance * 100)}%`} size="small" sx={{ fontSize: 9, height: 18, minWidth: 40, bgcolor: relevance > 0.5 ? '#E8F5E9' : '#FFF8E1' }} />
                <Typography variant="caption" fontWeight={600}>{f.title}</Typography>
                <Typography variant="caption" color="text.secondary">~{(f.tokenEstimate ?? f.token_estimate ?? 0).toLocaleString()} tokens</Typography>
              </Box>
            );
          })}
        </Paper>
      )}

      <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 3, mb: 1 }}>Active Context Files ({activeFiles.length})</Typography>
      {activeFiles.map((f: AiContextFileRow) => (
        <Paper key={f.id} variant="outlined" sx={{ p: 1.5, mb: 1, borderLeft: '3px solid #7B1FA2' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" fontWeight={600}>{f.title}</Typography>
            <Typography variant="caption" color="text.secondary">~{(f.tokenEstimate ?? f.token_estimate ?? 0).toLocaleString()} tokens</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">{f.category} | Priority: {f.priority}</Typography>
        </Paper>
      ))}
    </Box>
  );
}

// ── Sub-Tab 3: Fine-tuning ───────────────────────────────────────────────────

function FineTuningTab() {
  const [triggerResult, setTriggerResult] = useState<TriggerResult | null>(null);
  const [triggering, setTriggering] = useState(false);

  const { data: stats } = useQuery({
    queryKey: llmTrainingStatsKeys.all,
    queryFn: () => apiClient.get<TrainingStatsResponse>('llm/training/stats'),
  });

  const { data: adapters } = useQuery({
    queryKey: llmTrainingAdaptersKeys.all,
    queryFn: () => apiClient.get<TrainingAdaptersResponse>('llm/training/adapters'),
  });

  const handleExport = async (format: string) => {
    try {
      const resp = await apiClient.instance.get(`llm/training/export?format=${format}`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a'); a.href = url; a.download = `training-${format}-${new Date().toISOString().split('T')[0]}.jsonl`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const r = await apiClient.post<TriggerResult>('llm/training/start', {});
      setTriggerResult(r);
    } catch (e: unknown) { setTriggerResult({ error: readErrorMessage(e, 'Failed') }); }
    setTriggering(false);
  };

  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2, fontSize: 12 }}>
        Fine-tuning creates a custom model adapter using QLoRA/DoRA. This requires sufficient training data (recommended: 100+ edited examples).
        The adapter is stored locally in Ollama and can be exported for deployment to other installations.
      </Alert>

      {/* Training Data Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700} color="#7B1FA2">{stats?.totalFeedback ?? 0}</Typography>
            <Typography variant="caption">Total Feedback</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700} color="#2E7D32">{stats?.readyForTraining ?? 0}</Typography>
            <Typography variant="caption">Ready for Training</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700} color="#b8621a">{stats?.edited ?? 0}</Typography>
            <Typography variant="caption">User Edited</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700} color="#327C8D">{stats?.avgRating ? Number(stats.avgRating).toFixed(1) : '—'}</Typography>
            <Typography variant="caption">Avg Rating</Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Export */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Export Training Dataset</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => handleExport('alpaca')} sx={{ textTransform: 'none' }}>Export Alpaca (JSONL)</Button>
          <Button size="small" variant="outlined" onClick={() => handleExport('chatml')} sx={{ textTransform: 'none' }}>Export ChatML</Button>
        </Box>
      </Paper>

      {/* Trigger Fine-tune */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Create Custom Model (Ollama)</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Creates a custom Ollama model with your configured system prompts. Requires Ollama to be running.
        </Typography>
        <Button variant="contained" onClick={handleTrigger} disabled={triggering}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
          {triggering ? 'Creating...' : 'Create Custom Model'}
        </Button>
        {triggerResult && (
          <Alert severity={triggerResult.error ? 'error' : 'success'} sx={{ mt: 1, fontSize: 11 }}>
            {triggerResult.error ?? `Model "${triggerResult.modelName}" created successfully.`}
          </Alert>
        )}
      </Paper>

      {/* Adapters */}
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Available Custom Models</Typography>
      {(adapters?.adapters ?? []).length === 0 ? (
        <Alert severity="info" sx={{ fontSize: 11 }}>No custom models found. Create one using the button above.</Alert>
      ) : (adapters?.adapters ?? []).map((a: TrainingAdapterRow, i: number) => (
        <Paper key={i} variant="outlined" sx={{ p: 1.5, mb: 1, borderLeft: '3px solid #7B1FA2' }}>
          <Typography variant="body2" fontWeight={600}>{a.name}</Typography>
          <Typography variant="caption" color="text.secondary">{a.size ? `${(a.size / 1e9).toFixed(1)} GB` : ''} | Modified: {a.modified_at ? new Date(a.modified_at).toLocaleDateString('en-AU') : '—'}</Typography>
        </Paper>
      ))}
    </Box>
  );
}

// ── Sub-Tab 4: Training Stats ────────────────────────────────────────────────

function TrainingStatsTab() {
  const { data: stats, isLoading } = useQuery({
    queryKey: llmTrainingStatsKeys.all,
    queryFn: () => apiClient.get<TrainingStatsResponse>('llm/training/stats'),
  });

  if (isLoading) return <CircularProgress size={24} />;

  const byAction = stats?.byAction ?? [];

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>Training Feedback by Action Type</Typography>
      {byAction.length === 0 ? (
        <Alert severity="info">No training feedback collected yet. Feedback is captured when clinicians edit or rate AI-generated content.</Alert>
      ) : byAction.map((a: TrainingStatsByActionRow) => {
        const total = a.total ?? 0;
        const edited = a.edited ?? 0;
        return (
          <Paper key={a.action} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{ACTION_TYPES.find(at => at.value === a.action)?.label ?? a.action}</Typography>
              <Typography variant="caption" color="text.secondary">{total} feedback | {edited} edited | Avg: {a.avgRating ? Number(a.avgRating).toFixed(1) : '—'}</Typography>
            </Box>
            <Chip label={total >= 100 ? 'Ready' : total >= 50 ? 'Almost' : 'Collecting'} size="small"
              sx={{ fontSize: 9, height: 18, bgcolor: total >= 100 ? '#E8F5E9' : total >= 50 ? '#FFF8E1' : '#F5F5F5', color: total >= 100 ? '#2E7D32' : total >= 50 ? '#E65100' : '#999' }} />
          </Paper>
        );
      })}
    </Box>
  );
}
