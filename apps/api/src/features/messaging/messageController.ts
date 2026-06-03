import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as messageService from './messageService';
import { MessageCreateSchema, MessageThreadCreateSchema } from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';

export async function createThread(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const dto = MessageThreadCreateSchema.parse(req.body);
    const thread = await messageService.createThread(auth, dto);
    res.status(201).json(thread);
  } catch (err) {
    next(err);
  }
}

export async function listThreads(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const ListThreadsQuerySchema = z.object({
      patientId: z.string().uuid().optional(),
      isArchived: z.union([z.string(), z.boolean()]).optional()
        .transform((v) => v === true || v === 'true'),
    });
    const query = ListThreadsQuerySchema.parse(req.query);
    const threads = await messageService.listThreads(auth, query);
    res.json(threads);
  } catch (err) {
    next(err);
  }
}

export async function getThread(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const thread = await messageService.getThread(auth, req.params['threadId']!);
    res.json(thread);
  } catch (err) {
    next(err);
  }
}

export async function getThreadMessages(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const messages = await messageService.getThreadMessages(auth, req.params['threadId']!);
    res.json(messages);
  } catch (err) {
    next(err);
  }
}

export async function sendMessage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    // Support threadId from URL param (POST /threads/:threadId/messages) or body
    const body = req.params.threadId ? { ...req.body, threadId: req.params.threadId } : req.body;
    const dto = MessageCreateSchema.parse(body);
    const message = await messageService.sendMessage(auth, dto);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}

export async function getInbox(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const InboxQuerySchema = z.object({
      unreadOnly: z
        .string()
        .optional()
        .transform((v) => v === 'true'),
    });
    const { unreadOnly } = InboxQuerySchema.parse(req.query);
    const messages = await messageService.getInbox(auth, unreadOnly);
    res.json(messages);
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    await messageService.markAsRead(auth, req.params['messageId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function markThreadRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    await messageService.markThreadRead(auth, req.params['threadId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function archiveThread(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    await messageService.archiveThread(auth, req.params['threadId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const count = await messageService.getUnreadCount(auth);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}
