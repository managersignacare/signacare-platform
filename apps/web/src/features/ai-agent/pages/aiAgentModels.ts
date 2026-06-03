import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { aiAgentKeys } from '../queryKeys';

export interface LlmModel {
  id: string;
  name: string;
  ollamaModel: string;
  type: string;
  description: string;
  bestFor: string[];
  available?: boolean;
}

interface HFModel {
  id: string;
  name: string;
  hfRepo: string;
  type: string;
  description: string;
  bestFor: string[];
  parameterSize: string;
  requiresGpu: boolean;
  downloaded: boolean;
  serverRunning: boolean;
}

export const STATIC_MODELS: LlmModel[] = [
  { id: 'llama3', name: 'Llama 3.2 (General)', ollamaModel: 'llama3.2', type: 'generative', description: 'General-purpose clinical documentation. Fast and reliable.', bestFor: ['maudsley', 'isbar', 'letter', 'ambient', 'admin-report', 'register-summary', 'discharge'] },
  { id: 'mentallama', name: 'MentalLLaMA', ollamaModel: 'mentallama', type: 'generative', description: 'Fine-tuned for psychiatric formulations, risk assessment, and mental health.', bestFor: ['formulation', '91day', 'med-summary', 'risk-assessment'] },
  { id: 'emollm', name: 'EmoLLM', ollamaModel: 'emollm', type: 'generative', description: 'Emotion-aware model for therapeutic responses and emotional analysis.', bestFor: ['formulation', 'ambient', 'therapeutic-response'] },
  { id: 'mentalbert', name: 'MentalBERT', ollamaModel: 'mentalbert', type: 'classifier', description: 'Mental health text classification — sentiment, risk, PHQ/GAD estimates.', bestFor: ['sentiment', 'risk-screen', 'phq-estimate'] },
  { id: 'medllama', name: 'MedLLaMA (Medical)', ollamaModel: 'medllama2', type: 'generative', description: 'Medical domain LLM — medication knowledge and clinical reasoning.', bestFor: ['med-summary', 'discharge', 'letter', 'drug-info'] },
  { id: 'qwen2.5', name: 'Qwen 2.5 (14B)', ollamaModel: 'qwen2.5:14b', type: 'generative', description: 'Large reasoning model — best for complex agent tasks and comprehensive documents.', bestFor: ['maudsley', 'formulation', '91day', 'admin-report', 'agent'] },
];

export function useAvailableModels() {
  return useQuery({
    queryKey: aiAgentKeys.llmModels(),
    queryFn: async () => {
      try {
        const resp = await apiClient.get<{ models: LlmModel[]; huggingface?: HFModel[] }>('llm/models');
        const ollama = resp.models?.length ? resp.models : STATIC_MODELS;
        const hfModels: LlmModel[] = (resp.huggingface ?? []).map((hf) => ({
          id: `hf:${hf.id}`,
          name: `${hf.name} [HF]`,
          ollamaModel: hf.hfRepo,
          type: hf.type.includes('generation') ? 'generative' as const : 'classifier' as const,
          description: `${hf.description} (${hf.parameterSize}${hf.requiresGpu ? ', GPU' : ', CPU'})`,
          bestFor: hf.bestFor,
          available: hf.downloaded,
        }));
        return [...ollama, ...hfModels];
      } catch {
        return STATIC_MODELS;
      }
    },
    staleTime: 60_000,
  });
}
