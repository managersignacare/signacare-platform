import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const templateServiceMock = vi.hoisted(() => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../../src/features/templates/template.service', () => ({
  templateService: templateServiceMock,
}));

import { templateController } from '../../src/features/templates/template.controller';

function createResponseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  (response.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(response);
  return response;
}

function createRequestMock(overrides?: Partial<Request>): Request {
  return {
    user: {
      clinicId: '11111111-1111-1111-1111-111111111111',
      id: '99999999-9999-4999-8999-999999999999',
    },
    params: {},
    body: {},
    query: {},
    ...overrides,
  } as Request;
}

describe('templateController category handlers', () => {
  const next = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listCategories returns a canonical categories envelope', async () => {
    const req = createRequestMock();
    const res = createResponseMock();
    templateServiceMock.listCategories.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        clinicId: '11111111-1111-1111-1111-111111111111',
        name: 'Clinical Notes',
        isActive: true,
        sortOrder: 0,
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    await templateController.listCategories(req, res, next);

    expect(templateServiceMock.listCategories).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(res.json).toHaveBeenCalledWith({
      categories: [
        expect.objectContaining({ name: 'Clinical Notes', isActive: true }),
      ],
    });
  });

  it('createCategory validates the request body and returns 201', async () => {
    const req = createRequestMock({
      body: { name: 'Letters' },
    });
    const res = createResponseMock();
    templateServiceMock.createCategory.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      clinicId: '11111111-1111-1111-1111-111111111111',
      name: 'Letters',
      isActive: true,
      sortOrder: 0,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    });

    await templateController.createCategory(req, res, next);

    expect(templateServiceMock.createCategory).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      { name: 'Letters' },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      category: expect.objectContaining({ name: 'Letters', isActive: true }),
    });
  });

  it('createCategory fails closed on invalid input', async () => {
    const req = createRequestMock({
      body: { name: '' },
    });
    const res = createResponseMock();

    await templateController.createCategory(req, res, next);

    expect(templateServiceMock.createCategory).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        error: 'Validation failed',
      }),
    );
  });

  it('updateCategory validates the request body before delegating', async () => {
    const req = createRequestMock({
      params: { id: '44444444-4444-4444-8444-444444444444' },
      body: { name: 'Referral Letters', isActive: false, sortOrder: 4 },
    });
    const res = createResponseMock();
    templateServiceMock.updateCategory.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      clinicId: '11111111-1111-1111-1111-111111111111',
      name: 'Referral Letters',
      isActive: false,
      sortOrder: 4,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    });

    await templateController.updateCategory(req, res, next);

    expect(templateServiceMock.updateCategory).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      { name: 'Referral Letters', isActive: false, sortOrder: 4 },
    );
    expect(res.json).toHaveBeenCalledWith({
      category: expect.objectContaining({ sortOrder: 4, isActive: false }),
    });
  });

  it('list passes the actor id through so default clinical-note templates can be seeded safely', async () => {
    const req = createRequestMock({
      query: {
        status: 'published',
        category: 'Clinical Notes',
        q: 'progress',
      },
    });
    const res = createResponseMock();
    templateServiceMock.list.mockResolvedValue([
      { id: 'template-1', name: 'Progress Note (Mental Health)' },
    ]);

    await templateController.list(req, res, next);

    expect(templateServiceMock.list).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '99999999-9999-4999-8999-999999999999',
      {
        status: 'published',
        category: 'Clinical Notes',
        q: 'progress',
      },
    );
    expect(res.json).toHaveBeenCalledWith([
      { id: 'template-1', name: 'Progress Note (Mental Health)' },
    ]);
  });
});
