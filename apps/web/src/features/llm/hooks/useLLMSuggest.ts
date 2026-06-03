// apps/web/src/features/llm/hooks/useLLMSuggest.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useReducer } from 'react';
import { llmApi } from '../services/llmApi';
import { llmKeys } from '../queryKeys';
import type {
  LLMSuggestionState,
  LLMSuggestionType,
  LLMSource,
  SOAPGenerateRequest,
  SummaryGenerateRequest,
  ReferralLetterRequest,
  RiskAnalysisRequest,
  SOAPNote,
} from '../types/llmTypes';

// ── State machine ─────────────────────────────────────────────────────────────

type LLMAction =
  | { type: 'REQUEST'; suggestionType: LLMSuggestionType; source: LLMSource }
  | { type: 'SUCCESS'; result: SOAPNote | string }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

const initialState: LLMSuggestionState = {
  type: null,
  status: 'idle',
  result: null,
  error: null,
  source: null,
};

function reducer(
  state: LLMSuggestionState,
  action: LLMAction,
): LLMSuggestionState {
  switch (action.type) {
    case 'REQUEST':
      return {
        ...state,
        type: action.suggestionType,
        source: action.source,
        status: 'loading',
        result: null,
        error: null,
      };
    case 'SUCCESS':
      return { ...state, status: 'success', result: action.result };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLLMSuggest() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const queryClient = useQueryClient();

  const soapMutation = useMutation({
    mutationFn: (payload: SOAPGenerateRequest) => llmApi.generateSOAP(payload),
    onSuccess: result => dispatch({ type: 'SUCCESS', result }),
    onError: (err: Error) => dispatch({ type: 'ERROR', error: err.message }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: llmKeys.health() }); },
  });

  const summaryMutation = useMutation({
    mutationFn: (payload: SummaryGenerateRequest) =>
      llmApi.generateClinicalSummary(payload),
    onSuccess: result => dispatch({ type: 'SUCCESS', result }),
    onError: (err: Error) => dispatch({ type: 'ERROR', error: err.message }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: llmKeys.health() }); },
  });

  const letterMutation = useMutation({
    mutationFn: (payload: ReferralLetterRequest) =>
      llmApi.draftReferralLetter(payload),
    onSuccess: result => dispatch({ type: 'SUCCESS', result }),
    onError: (err: Error) => dispatch({ type: 'ERROR', error: err.message }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: llmKeys.health() }); },
  });

  const riskMutation = useMutation({
    mutationFn: (payload: RiskAnalysisRequest) =>
      llmApi.generateRiskAnalysis(payload),
    onSuccess: result => dispatch({ type: 'SUCCESS', result }),
    onError: (err: Error) => dispatch({ type: 'ERROR', error: err.message }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: llmKeys.health() }); },
  });

  const requestSOAP = useCallback(
    (payload: SOAPGenerateRequest) => {
      dispatch({
        type: 'REQUEST',
        suggestionType: 'soap_note',
        source: payload.source,
      });
      soapMutation.mutate(payload);
    },
    [soapMutation],
  );

  const requestSummary = useCallback(
    (payload: SummaryGenerateRequest) => {
      dispatch({
        type: 'REQUEST',
        suggestionType: 'clinical_summary',
        source: 'note_history',
      });
      summaryMutation.mutate(payload);
    },
    [summaryMutation],
  );

  const requestLetter = useCallback(
    (payload: ReferralLetterRequest) => {
      dispatch({
        type: 'REQUEST',
        suggestionType: 'referral_letter',
        source: 'manual',
      });
      letterMutation.mutate(payload);
    },
    [letterMutation],
  );

  const requestRiskAnalysis = useCallback(
    (payload: RiskAnalysisRequest) => {
      dispatch({
        type: 'REQUEST',
        suggestionType: 'risk_analysis',
        source: 'manual',
      });
      riskMutation.mutate(payload);
    },
    [riskMutation],
  );

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    state,
    requestSOAP,
    requestSummary,
    requestLetter,
    requestRiskAnalysis,
    reset,
  };
}

// ── LLM health check ──────────────────────────────────────────────────────────

export function useLLMHealth() {
  return useQuery({
    queryKey: llmKeys.health(),
    queryFn: llmApi.healthCheck,
    refetchInterval: 60 * 1_000,
    staleTime: 30 * 1_000,
  });
}
