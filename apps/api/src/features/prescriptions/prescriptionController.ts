import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prescriptionService } from './prescriptionService';
import {
  PrescriptionCreateSchema,
  PrescriptionCancelSchema,
  SafeScriptPatientIdentifierSchema,
  type SafeScriptPatientIdentifier,
} from '@signacare/shared';
import { escriptService, type ErxSubmitPayload } from '../../integrations/escript/escriptService';
// BUG-292 — prescriptionService migrated to AuthContext-first.
import { buildAuthContext } from '../../shared/buildAuthContext';
import { checkPatientMySLStatus, requestConsent, getActiveScripts, isMySLConfigured } from '../../integrations/escript/myslClient';
import { deliverToken } from '../../integrations/escript/tokenDeliveryService';
import {
  verifyIhi,
  isHiServiceConfigured,
  updateIhiPatientDetails,
  createVerifiedNewbornIhi,
} from '../../integrations/hiService/hiServiceClient';
import { ihiConformanceService } from './ihiConformanceService';
import { searchIhiWithPriority } from './ihiSearchPriority';
import { ErxSubmitContractSchema } from './erxRegulatoryContract';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §3.1) ───────────────────────────
// Every POST accepting req.body validates shape before calling downstream
// integration code. Scoped to this file per §12 (local helpers, no cross-
// file abstraction). Shapes mirror the integration `interface` declarations
// exactly — schema drift is caught at request time, not at SOAP/FHIR time.

const MySLConsentRequestSchema = z.object({
  patientFhirId: z.string().min(1),
});

const TokenDeliveryPayloadSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string().min(1).optional(),
  phoneMobile: z.string().optional(),
  email: z.string().email().optional(),
  erxToken: z.string().min(1),
  scid: z.string().min(1).optional(),
  dspId: z.string().min(1).optional(),
  medicationName: z.string().min(1).optional(),
  prescribedDate: z.string().min(1).optional(),
  prescribedBy: z.string().min(1).optional(),
  clinicName: z.string().min(1).optional(),
}).refine((value) => !!value.phoneMobile || !!value.email, {
  message: 'At least one token delivery channel (phoneMobile or email) is required',
});

const VerifyIhiRequestSchema = z.object({
  ihi: z.string().regex(/^\d{16}$/, 'IHI must be 16 digits'),
  patientId: z.string().uuid().optional(),
});

const UpdateIhiDetailsRequestSchema = z.object({
  patientId: z.string().uuid(),
  ihi: z.string().regex(/^\d{16}$/, 'IHI must be 16 digits'),
  familyName: z.string().min(1),
  givenName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  gender: z.enum(['M', 'F', 'I', 'N']),
  medicareNumber: z.string().regex(/^\d{10,11}$/, 'Medicare number must be 10-11 digits').optional(),
  medicareIrn: z.string().regex(/^[1-9]$/, 'Medicare IRN must be a single digit 1-9').optional(),
  mobile: z.string().min(6).max(30).optional(),
  email: z.string().email().optional(),
}).superRefine((v, ctx) => {
  const hasMedicare = !!v.medicareNumber || !!v.medicareIrn;
  if (hasMedicare && (!v.medicareNumber || !v.medicareIrn)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['medicareIrn'],
      message: 'Medicare updates require both medicareNumber and medicareIrn.',
    });
  }
});

const CreateNewbornIhiRequestSchema = z.object({
  patientId: z.string().uuid(),
  newbornFamilyName: z.string().min(1),
  newbornGivenName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  gender: z.enum(['M', 'F', 'I', 'N']),
  motherIhi: z.string().regex(/^\d{16}$/, 'Mother IHI must be 16 digits'),
  motherMedicareNumber: z.string().regex(/^\d{10,11}$/, 'Mother Medicare number must be 10-11 digits').optional(),
  motherMedicareIrn: z.string().regex(/^[1-9]$/, 'Mother Medicare IRN must be a single digit 1-9').optional(),
}).superRefine((v, ctx) => {
  const hasMedicare = !!v.motherMedicareNumber || !!v.motherMedicareIrn;
  if (hasMedicare && (!v.motherMedicareNumber || !v.motherMedicareIrn)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['motherMedicareIrn'],
      message: 'Mother Medicare details require both number and IRN.',
    });
  }
});

const IhiDetailsUpdateResultSchema = z.object({
  success: z.boolean(),
  requestRef: z.string().optional(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
});

const NewbornIhiCreateResultSchema = z.object({
  success: z.boolean(),
  ihi: z.string().optional(),
  ihiStatus: z.enum(['active', 'deceased', 'retired', 'expired', 'resolved']).optional(),
  ihiRecordStatus: z.enum(['verified', 'unverified', 'provisional']).optional(),
  requestRef: z.string().optional(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
});

const IhiSearchParamsSchema = z.object({
  familyName: z.string().min(1),
  givenName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  gender: z.enum(['M', 'F', 'I', 'N']),
  medicareNumber: z.string().regex(/^\d{10,11}$/, 'Medicare number must be 10-11 digits').optional(),
  medicareIrn: z.string().regex(/^[1-9]$/, 'Medicare IRN must be a single digit 1-9').optional(),
  dvaNumber: z.string().min(5).max(30).optional(),
  mobile: z.string().min(6).max(30).optional(),
  email: z.string().email().optional(),
  patientId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  const hasMedicare = !!v.medicareNumber || !!v.medicareIrn;
  if (hasMedicare && (!v.medicareNumber || !v.medicareIrn)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['medicareIrn'],
      message: 'Medicare searches require both medicareNumber and medicareIrn.',
    });
  }
  if (!hasMedicare && !v.dvaNumber && !v.mobile && !v.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['medicareNumber'],
      message: 'Provide one identity path: Medicare+IRN, DVA number, mobile, or email.',
    });
  }
});

export const listPrescriptions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const { status } = req.query as { status?: string };
    const auth = buildAuthContext(req, patientId);
    const result = await prescriptionService.listByPatient(
      auth,
      patientId,
      status,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getPrescription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await prescriptionService.getById(auth, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createPrescription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = PrescriptionCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await prescriptionService.create(auth, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const runSafeScriptCheck = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const identifier: SafeScriptPatientIdentifier = SafeScriptPatientIdentifierSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const result = await prescriptionService.runSafeScriptCheck(
      auth,
      req.params.id,
      identifier,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const submitErx = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const payload: ErxSubmitPayload = ErxSubmitContractSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const result = await prescriptionService.submitErx(auth, req.params.id, payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// BUG-371b — REQUIRED expectedLockVersion on prescription cancel.
// BUG-553 — REQUIRED reasonForCancellation (1..500) for AHPRA S8/SafeScript
// forensic chain. Schema lives in @signacare/shared as
// `PrescriptionCancelSchema` (SSoT — frontend POSTs the same shape).
export const cancelPrescription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const { expectedLockVersion, reasonForCancellation } =
      PrescriptionCancelSchema.parse(req.body);
    const result = await prescriptionService.cancel(
      auth,
      req.params.id,
      expectedLockVersion,
      reasonForCancellation,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ── MySL (My Script List) ─────────────────────────────────────────────────────

export const getMySLStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ihi } = req.params;
    const result = await checkPatientMySLStatus(ihi);
    res.json(IhiDetailsUpdateResultSchema.parse(result));
  } catch (err) { next(err); }
};

export const postMySLConsentRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { patientFhirId } = MySLConsentRequestSchema.parse(req.body);
    const result = await requestConsent(patientFhirId);
    res.json(NewbornIhiCreateResultSchema.parse(result));
  } catch (err) { next(err); }
};

export const getMySLScripts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { patientFhirId } = req.params;
    const result = await getActiveScripts(patientFhirId);
    res.json(result);
  } catch (err) { next(err); }
};

export const getMySLConfigStatus = (_req: Request, res: Response): void => {
  res.json({ configured: isMySLConfigured() });
};

// ── Token Delivery ────────────────────────────────────────────────────────────

export const postDeliverToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = TokenDeliveryPayloadSchema.parse(req.body);
    const result = await deliverToken(req.clinicId, req.user!.id, payload);
    res.json(result);
  } catch (err) { next(err); }
};

// ── HI Service (IHI Validation) ───────────────────────────────────────────────

export const postVerifyIhi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ihi, patientId } = VerifyIhiRequestSchema.parse(req.body);
    const auth = buildAuthContext(req, patientId);
    const result = await verifyIhi(ihi);
    if (result.error) {
      await ihiConformanceService.recordHiFailure(auth, {
        patientId: patientId ?? null,
        operation: 'verify_ihi',
        errorCode: 'HI_VERIFY_ERROR',
        errorMessage: result.error,
        context: { ihi },
      });
    }
    if (
      patientId
      && result.found
      && result.ihi
      && result.ihiRecordStatus
      && result.ihiStatus
    ) {
      await ihiConformanceService.persistVerificationSnapshot(auth, {
        patientId,
        ihi: result.ihi,
        recordStatus: result.ihiRecordStatus,
        numberStatus: result.ihiStatus,
        source: 'hi_verify',
        displayName: result.displayName
          ?? ([result.givenName, result.familyName].filter(Boolean).join(' ') || null),
      });
    }
    res.json(result);
  } catch (err) { next(err); }
};

export const postSearchIhi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const params = IhiSearchParamsSchema.parse(req.body);
    const auth = buildAuthContext(req, params.patientId);
    const searchOutcome = await searchIhiWithPriority({
      familyName: params.familyName,
      givenName: params.givenName,
      dateOfBirth: params.dateOfBirth,
      gender: params.gender,
      medicareNumber: params.medicareNumber,
      medicareIrn: params.medicareIrn,
      dvaNumber: params.dvaNumber,
      mobile: params.mobile,
      email: params.email,
    });
    const result = searchOutcome.result;
    if (result.error) {
      await ihiConformanceService.recordHiFailure(auth, {
        patientId: params.patientId ?? null,
        operation: 'search_ihi',
        errorCode: 'HI_SEARCH_ERROR',
        errorMessage: result.error,
        context: {
          searchPath: searchOutcome.winningPath
            ?? searchOutcome.attempts[0]?.path
            ?? 'unknown',
          attemptedPaths: searchOutcome.attempts.map((attempt) => attempt.path),
          conflict: searchOutcome.conflict,
        },
      });
    }
    if (
      params.patientId
      && result.found
      && result.ihi
      && result.ihiRecordStatus
      && result.ihiStatus
    ) {
      await ihiConformanceService.persistVerificationSnapshot(auth, {
        patientId: params.patientId,
        ihi: result.ihi,
        recordStatus: result.ihiRecordStatus,
        numberStatus: result.ihiStatus,
        source: 'hi_search',
        displayName: result.displayName
          ?? ([result.givenName, result.familyName].filter(Boolean).join(' ') || null),
      });
    }
    res.json(result);
  } catch (err) { next(err); }
};

export const postUpdateIhiDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = UpdateIhiDetailsRequestSchema.parse(req.body);
    const auth = buildAuthContext(req, payload.patientId);
    const result = await updateIhiPatientDetails({
      ihi: payload.ihi,
      familyName: payload.familyName,
      givenName: payload.givenName,
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
      medicareNumber: payload.medicareNumber,
      medicareIrn: payload.medicareIrn,
      mobile: payload.mobile,
      email: payload.email,
    });

    if (!result.success && result.error) {
      await ihiConformanceService.recordHiFailure(auth, {
        patientId: payload.patientId,
        operation: 'update_ihi_details',
        errorCode: 'HI_UPDATE_ERROR',
        errorMessage: result.error,
        statusCode: result.statusCode ?? null,
        requestRef: result.requestRef ?? null,
        context: {
          ihi: payload.ihi,
          hasMedicare: !!payload.medicareNumber,
          hasMobile: !!payload.mobile,
          hasEmail: !!payload.email,
        },
      });
    }

    res.json(result);
  } catch (err) { next(err); }
};

export const postCreateNewbornIhi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = CreateNewbornIhiRequestSchema.parse(req.body);
    const auth = buildAuthContext(req, payload.patientId);
    const result = await createVerifiedNewbornIhi({
      newbornFamilyName: payload.newbornFamilyName,
      newbornGivenName: payload.newbornGivenName,
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
      motherIhi: payload.motherIhi,
      motherMedicareNumber: payload.motherMedicareNumber,
      motherMedicareIrn: payload.motherMedicareIrn,
    });
    if (!result.success && result.error) {
      await ihiConformanceService.recordHiFailure(auth, {
        patientId: payload.patientId,
        operation: 'create_newborn_ihi',
        errorCode: 'HI_NEWBORN_CREATE_ERROR',
        errorMessage: result.error,
        statusCode: result.statusCode ?? null,
        requestRef: result.requestRef ?? null,
        context: {
          motherIhi: payload.motherIhi,
          dateOfBirth: payload.dateOfBirth,
        },
      });
    }
    res.json(result);
  } catch (err) { next(err); }
};

export const getHiServiceStatus = (_req: Request, res: Response): void => {
  res.json({ configured: isHiServiceConfigured() });
};

// ── eRx Integration Status ────────────────────────────────────────────────────

export const getErxStatus = (_req: Request, res: Response): void => {
  res.json({
    etp1: { configured: escriptService.isEtp1Configured(), label: 'eRx Adapter (ETP1 Paper)' },
    etp2: { configured: escriptService.isEtp2Configured(), label: 'NPDS (ETP2 Electronic)' },
    mysl: { configured: isMySLConfigured(), label: 'MySL (Active Script List)' },
    hi:   { configured: isHiServiceConfigured(), label: 'HI Service (IHI/HPII)' },
    anyConfigured: escriptService.isConfigured(),
  });
};

// ── eRx ETP1 Dispense Poll ────────────────────────────────────────────────────

export const pollDispenseNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await prescriptionService.pollAndApplyDispenseNotifications(auth);
    // @response-shape-exempt: operational poll status envelope (matched/updated counters) is a transport contract for scheduler/operator diagnostics.
    res.json({
      notifications: result.notifications,
      count: result.notifications.length,
      matched: result.matched,
      updated: result.updated,
      unmatched: result.unmatched,
      alreadyDispensed: result.alreadyDispensed,
      errors: result.errors,
    });
  } catch (err) { next(err); }
};
