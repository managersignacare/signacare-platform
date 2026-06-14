import { beforeEach, describe, expect, it, vi } from 'vitest';

const templateRepositoryMock = vi.hoisted(() => ({
  findCategoryByName: vi.fn(),
  createCategory: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('../../src/features/templates/template.repository', () => ({
  templateRepository: templateRepositoryMock,
}));

import { ensureDefaultClinicalNoteTemplates } from '../../src/features/templates/defaultClinicalNoteTemplates';

describe('defaultClinicalNoteTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateRepositoryMock.create.mockImplementation(async (_clinicId, _actorId, payload) => ({
      id: `${payload.name}-id`,
      ...payload,
    }));
    templateRepositoryMock.setStatus.mockResolvedValue(undefined);
  });

  it('creates the Clinical Notes category if it does not exist and seeds the default templates', async () => {
    templateRepositoryMock.findCategoryByName.mockResolvedValue(null);
    templateRepositoryMock.list.mockResolvedValue([]);

    await ensureDefaultClinicalNoteTemplates(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );

    expect(templateRepositoryMock.createCategory).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'Clinical Notes',
    );
    expect(templateRepositoryMock.create).toHaveBeenCalledTimes(5);
    expect(templateRepositoryMock.setStatus).toHaveBeenCalledTimes(5);
    expect(templateRepositoryMock.create).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      expect.objectContaining({
        category: 'Clinical Notes',
        name: 'Progress Note (Mental Health)',
      }),
    );
  });

  it('does not recreate templates that already exist by name', async () => {
    templateRepositoryMock.findCategoryByName.mockResolvedValue({
      id: 'category-id',
      name: 'Clinical Notes',
    });
    templateRepositoryMock.list.mockResolvedValue([
      { id: 'existing-progress', name: 'Progress Note (Mental Health)' },
      { id: 'existing-family', name: 'Family Meeting Note' },
    ]);

    await ensureDefaultClinicalNoteTemplates(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );

    expect(templateRepositoryMock.createCategory).not.toHaveBeenCalled();
    expect(templateRepositoryMock.create).toHaveBeenCalledTimes(3);
    expect(templateRepositoryMock.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ name: 'Progress Note (Mental Health)' }),
    );
    expect(templateRepositoryMock.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ name: 'Family Meeting Note' }),
    );
  });
});
