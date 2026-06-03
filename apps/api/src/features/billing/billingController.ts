import type { Request, Response, NextFunction } from 'express';
import * as billingService from './billingService';
import {
  BillingAccountCreateSchema,
  InvoiceCreateSchema,
  PaymentCreateSchema,
  ClaimUpdateSchema,
} from '@signacare/shared';

export async function upsertBillingAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = BillingAccountCreateSchema.parse(req.body);
    const account = await billingService.upsertBillingAccount(req.user!.clinicId, dto);
    res.json(account);
  } catch (err) {
    next(err);
  }
}

export async function getBillingAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const account = await billingService.getBillingAccount(
      req.user!.clinicId,
      req.params['patientId']!,
    );
    if (!account) {
      res
        .status(404)
        .json({ error: 'Billing account not found', code: 'BILLING_ACCOUNT_NOT_FOUND' });
      return;
    }
    res.json(account);
  } catch (err) {
    next(err);
  }
}

export async function createInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = InvoiceCreateSchema.parse(req.body);
    const invoice = await billingService.createInvoice(req.user!.clinicId, dto);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function listInvoices(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoices = await billingService.listInvoicesByPatient(
      req.user!.clinicId,
      req.params['patientId']!,
    );
    res.json(invoices);
  } catch (err) {
    next(err);
  }
}

export async function getInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoice = await billingService.getInvoice(
      req.user!.clinicId,
      req.params['invoiceId']!,
    );
    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function voidInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await billingService.voidInvoice(req.user!.clinicId, req.params['invoiceId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function recordPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = PaymentCreateSchema.parse(req.body);
    const payment = await billingService.recordPayment(
      req.user!.clinicId,
      req.user!.id,
      dto,
    );
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
}

export async function listPayments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payments = await billingService.listPaymentsByInvoice(
      req.user!.clinicId,
      req.params['invoiceId']!,
    );
    res.json(payments);
  } catch (err) {
    next(err);
  }
}

export async function updateClaim(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = ClaimUpdateSchema.parse(req.body);
    await billingService.updateClaimStatus(
      req.user!.clinicId,
      req.params['paymentId']!,
      dto,
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
