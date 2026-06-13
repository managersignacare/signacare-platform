import React from 'react';
import {
  Chip,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  useAiRuntimeHealth,
  useAllClinics,
  useClinicAiRuntimeSettings,
  useUpdateClinicAiRuntimeSettings,
} from '../hooks/usePowerSettings';

function toneForStatus(status?: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE' | 'ERROR') {
  switch (status) {
    case 'OK':
      return 'success';
    case 'UNCONFIGURED':
      return 'warning';
    case 'UNREACHABLE':
    case 'ERROR':
      return 'error';
    default:
      return 'default';
  }
}

export function PowerAiRuntimePanel() {
  const { data: clinics, isLoading: clinicsLoading } = useAllClinics();
  const runtimeHealthQuery = useAiRuntimeHealth();
  const [selectedClinicId, setSelectedClinicId] = React.useState('');
  const { mutateAsync: updateRuntime, isPending } = useUpdateClinicAiRuntimeSettings();

  React.useEffect(() => {
    if (!selectedClinicId && clinics?.length) {
      setSelectedClinicId(clinics[0].id);
    }
  }, [clinics, selectedClinicId]);

  const runtimeQuery = useClinicAiRuntimeSettings(selectedClinicId);
  const runtime = runtimeQuery.data;

  const [llmBackend, setLlmBackend] = React.useState<'local_ollama' | 'azure_openai'>('local_ollama');
  const [scribeRuntimeMode, setScribeRuntimeMode] = React.useState<'standard' | 'agentic'>('standard');
  const [localStyleAdapterModelName, setLocalStyleAdapterModelName] = React.useState('');
  const [success, setSuccess] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!runtime) return;
    setLlmBackend(runtime.llmBackend);
    setScribeRuntimeMode(runtime.scribeRuntimeMode);
    setLocalStyleAdapterModelName(runtime.localStyleAdapterModelName ?? '');
    setSuccess(null);
    setError(null);
  }, [runtime]);

  const azureReady = runtimeHealthQuery.data?.azureOpenAi?.status === 'OK';
  const ollamaHealthy = runtimeHealthQuery.data?.ollama?.status === 'OK';
  const whisperHealthy = runtimeHealthQuery.data?.whisper?.status === 'OK';

  if (clinicsLoading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" mb={1}>
          AI Runtime
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Whisper remains the default transcription runtime for AI Scribe. Text generation defaults to Ollama, and OpenAI stays an explicit opt-in when the hosted lane is configured and healthy.
        </Typography>

        <Stack spacing={2.5}>
          <Alert severity="info">
            Default runtime policy: <strong>Whisper Sync</strong> for transcription, <strong>Ollama</strong> for text generation. Switch to <strong>OpenAI (Azure-hosted)</strong> only when you explicitly want the hosted lane for this clinic.
          </Alert>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} flexWrap="wrap">
            <Chip
              label={`Ollama ${runtimeHealthQuery.isLoading ? 'checking…' : (ollamaHealthy ? 'healthy' : runtimeHealthQuery.data?.ollama?.status?.toLowerCase() ?? 'unknown')}`}
              color={toneForStatus(runtimeHealthQuery.data?.ollama?.status)}
              variant="outlined"
            />
            <Chip
              label={`Whisper Sync ${runtimeHealthQuery.isLoading ? 'checking…' : (whisperHealthy ? 'healthy' : runtimeHealthQuery.data?.whisper?.status?.toLowerCase() ?? 'unknown')}`}
              color={toneForStatus(runtimeHealthQuery.data?.whisper?.status)}
              variant="outlined"
            />
            <Chip
              label={`OpenAI ${runtimeHealthQuery.isLoading ? 'checking…' : (azureReady ? 'ready for explicit selection' : runtimeHealthQuery.data?.azureOpenAi?.status?.toLowerCase() ?? 'unknown')}`}
              color={toneForStatus(runtimeHealthQuery.data?.azureOpenAi?.status)}
              variant="outlined"
            />
          </Stack>

          {!runtimeHealthQuery.isLoading && !ollamaHealthy && (
            <Alert severity="warning">
              Ollama is not currently healthy. Text generation still defaults to Ollama by policy, so fix the local lane before broad clinic use.
            </Alert>
          )}

          {!runtimeHealthQuery.isLoading && !whisperHealthy && (
            <Alert severity="warning">
              Whisper Sync is not currently healthy. Ambient transcription and AI scribe flows may be degraded until the transcription lane recovers.
            </Alert>
          )}

          {!runtimeHealthQuery.isLoading && !azureReady && (
            <Alert severity="info">
              OpenAI stays opt-in only. It is currently unavailable for selection because the hosted runtime is not fully configured or healthy.
            </Alert>
          )}

          <TextField
            select
            label="Clinic"
            value={selectedClinicId}
            onChange={(event) => setSelectedClinicId(event.target.value)}
            size="small"
            fullWidth
          >
            {clinics?.map((clinic) => (
              <MenuItem key={clinic.id} value={clinic.id}>
                {clinic.name}
              </MenuItem>
            ))}
          </TextField>

          {runtimeQuery.isLoading && (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          )}

          {runtime && (
            <>
              <TextField
                select
                label="Text Generation Backend"
                value={llmBackend}
                onChange={(event) => setLlmBackend(event.target.value as 'local_ollama' | 'azure_openai')}
                size="small"
                fullWidth
                helperText="Ollama stays the clinic default. OpenAI is a deliberate hosted override and is disabled here until the hosted lane is healthy."
              >
                <MenuItem value="local_ollama">Ollama (default)</MenuItem>
                <MenuItem value="azure_openai" disabled={!azureReady}>
                  OpenAI (Azure-hosted, explicit opt-in)
                </MenuItem>
              </TextField>

              <TextField
                select
                label="Preferred Scribe Mode"
                value={scribeRuntimeMode}
                onChange={(event) => setScribeRuntimeMode(event.target.value as 'standard' | 'agentic')}
                size="small"
                fullWidth
                helperText="This controls the clinic’s preferred scribe surface. Whisper Sync remains the transcription backend either way."
              >
                <MenuItem value="standard">Medical Scribe</MenuItem>
                <MenuItem value="agentic">Medical Scribe + Drafting</MenuItem>
              </TextField>

              <TextField
                label="Local Style Adapter Model"
                value={localStyleAdapterModelName}
                onChange={(event) => setLocalStyleAdapterModelName(event.target.value)}
                size="small"
                fullWidth
                placeholder="signacare-clinic-xxxx or custom:tag"
                helperText="Optional. Used only on the local Ollama lane. This stays saved even if the clinic switches to Azure, so local training/adaptation is not lost."
              />

              {llmBackend === 'azure_openai' && localStyleAdapterModelName.trim().length > 0 && (
                <Alert severity="info">
                  OpenAI routing is active. The local Ollama adapter remains stored for later use if the clinic switches back to the default lane.
                </Alert>
              )}

              {error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">{success}</Alert>}

              <Box display="flex" justifyContent="flex-end">
                <Button
                  variant="contained"
                  disabled={isPending || !selectedClinicId}
                  onClick={async () => {
                    if (!selectedClinicId) return;
                    setError(null);
                    setSuccess(null);
                    try {
                      await updateRuntime({
                        clinicId: selectedClinicId,
                        data: {
                          llmBackend,
                          scribeRuntimeMode,
                          localStyleAdapterModelName: localStyleAdapterModelName.trim() || null,
                        },
                      });
                      setSuccess('AI runtime settings saved.');
                    } catch (saveError) {
                      const message =
                        saveError instanceof Error
                          ? saveError.message
                          : 'Failed to save AI runtime settings.';
                      setError(message);
                    }
                  }}
                >
                  {isPending ? 'Saving...' : 'Save Runtime'}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
