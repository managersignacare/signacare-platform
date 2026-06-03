import type { NextFunction, Request, Response, Router } from 'express';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { logger } from '../../utils/logger';

export function registerHuggingFaceRoutes(router: Router): void {
  // GET /api/v1/llm/models — list all available models (Ollama + HuggingFace)
  router.get(
    '/models',
    requireRoles(['clinician', 'admin', 'superadmin']),
    requireModuleRead(MODULE_KEYS.AI),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const { listAvailableModels } = await import('../../mcp/localLlmAgent');
        const { listHFModels, HF_MODEL_REGISTRY } = await import('../../mcp/huggingfaceService');

        const [ollamaModels, hfModels] = await Promise.all([
          listAvailableModels().catch((err) => {
            logger.warn({ err }, 'Failed to list LLM models');
            return [];
          }),
          listHFModels().catch(() => HF_MODEL_REGISTRY.map((model) => ({ ...model, downloaded: false, serverRunning: false }))),
        ]);

        // @response-shape-exempt: model catalog combines heterogeneous provider payloads (ollama + hf registry status), not a DB row-mapper surface
        res.json({
          models: ollamaModels,
          huggingface: hfModels,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/llm/hf/inference — direct HuggingFace model inference
  router.post(
    '/hf/inference',
    requireRoles(['clinician', 'admin', 'superadmin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { HfInferenceSchema } = await import('@signacare/shared');
        HfInferenceSchema.parse(req.body);
        const { callHuggingFace } = await import('../../mcp/huggingfaceService');
        const result = await callHuggingFace(req.body);
        // @response-shape-exempt: huggingface inference response is provider-native passthrough payload
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/llm/hf/classify — classify clinical text with HF models
  router.post(
    '/hf/classify',
    requireRoles(['clinician', 'admin', 'superadmin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { HfClassifySchema } = await import('@signacare/shared');
        const { text, model } = HfClassifySchema.parse(req.body);
        const { classifyWithHF } = await import('../../mcp/huggingfaceService');
        const result = await classifyWithHF(text, model);
        // @response-shape-exempt: huggingface classify response is provider-native passthrough payload
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/llm/hf/entities — extract medical entities with NER
  router.post(
    '/hf/entities',
    requireRoles(['clinician', 'admin', 'superadmin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { HfEntitiesSchema } = await import('@signacare/shared');
        const { text: entityText } = HfEntitiesSchema.parse(req.body);
        const { extractEntities } = await import('../../mcp/huggingfaceService');
        const result = await extractEntities(entityText);
        // @response-shape-exempt: huggingface entities response is provider-native passthrough payload
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/llm/hf/download — download a model from HuggingFace Hub
  router.post(
    '/hf/download',
    requireRoles(['admin', 'superadmin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { HfDownloadSchema } = await import('@signacare/shared');
        const { model: dlModel } = HfDownloadSchema.parse(req.body);
        const { downloadHFModel } = await import('../../mcp/huggingfaceService');
        const result = await downloadHFModel(dlModel);
        // @response-shape-exempt: huggingface download response is provider-native operation payload
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );
}
