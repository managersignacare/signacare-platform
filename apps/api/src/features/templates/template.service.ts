import { templateRepository } from './template.repository';
import { AppError } from '../../shared/errors';
import type { TemplateRow } from './template.repository';
import { ensureDefaultClinicalNoteTemplates } from './defaultClinicalNoteTemplates';
import type {
  CreateTemplateDTO,
  CreateTemplateCategoryDTO,
  UpdateTemplateDTO,
  UpdateTemplateCategoryDTO,
} from '@signacare/shared';

export const templateService = {
  async listCategories(clinicId: string) {
    return templateRepository.listCategories(clinicId);
  },

  async createCategory(clinicId: string, dto: CreateTemplateCategoryDTO) {
    const existing = await templateRepository.findCategoryByName(clinicId, dto.name);
    if (existing) {
      throw new AppError('Template category name already exists', 409, 'TEMPLATE_CATEGORY_NAME_CONFLICT');
    }
    return templateRepository.createCategory(clinicId, dto.name);
  },

  async updateCategory(clinicId: string, id: string, dto: UpdateTemplateCategoryDTO) {
    if (dto.name !== undefined) {
      const existing = await templateRepository.findCategoryByName(clinicId, dto.name, id);
      if (existing) {
        throw new AppError('Template category name already exists', 409, 'TEMPLATE_CATEGORY_NAME_CONFLICT');
      }
    }
    const category = await templateRepository.updateCategory(clinicId, id, dto);
    if (!category) throw new AppError('Template category not found', 404, 'TEMPLATE_CATEGORY_NOT_FOUND');
    return category;
  },

  async deleteCategory(clinicId: string, id: string): Promise<void> {
    const category = await templateRepository.findCategoryById(clinicId, id);
    if (!category) throw new AppError('Template category not found', 404, 'TEMPLATE_CATEGORY_NOT_FOUND');
    const templatesUsingCategory = await templateRepository.countTemplatesUsingCategory(clinicId, category.name);
    if (templatesUsingCategory > 0) {
      throw new AppError(
        'Template category is still in use by existing templates',
        409,
        'TEMPLATE_CATEGORY_IN_USE',
      );
    }
    await templateRepository.deleteCategory(clinicId, id);
  },

  async list(
    clinicId: string,
    actorId: string,
    filters: { status?: string; category?: string; q?: string },
  ): Promise<TemplateRow[]> {
    await ensureDefaultClinicalNoteTemplates(clinicId, actorId);
    return templateRepository.list(clinicId, filters);
  },

  async getById(clinicId: string, id: string): Promise<TemplateRow> {
    const tpl = await templateRepository.findById(clinicId, id);
    if (!tpl) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
    return tpl;
  },

  async create(clinicId: string, createdById: string, dto: CreateTemplateDTO): Promise<TemplateRow> {
    return templateRepository.create(clinicId, createdById, {
      name:        dto.name,
      description: dto.description,
      category:    dto.category,
      sections:    (dto.sections ?? []).map((s) => ({
        label:       s.label,
        fieldType:   s.fieldType,
        soapField:   s.soapField ?? null,
        required:    s.required ?? false,
        position:    s.position ?? 0,
        options:     s.options ?? null,
        minValue:    s.minValue ?? null,
        maxValue:    s.maxValue ?? null,
        placeholder: s.placeholder ?? null,
      })),
    });
  },

  async update(clinicId: string, id: string, dto: UpdateTemplateDTO): Promise<TemplateRow> {
    const existing = await templateRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
    if (existing.status === 'retired') throw new AppError('Retired templates cannot be edited', 409, 'TEMPLATE_RETIRED');
    return templateRepository.update(clinicId, id, {
      name:        dto.name,
      description: dto.description,
      category:    dto.category,
      sections:    dto.sections?.map((s) => ({
        label:       s.label,
        fieldType:   s.fieldType,
        soapField:   s.soapField ?? null,
        required:    s.required ?? false,
        position:    s.position ?? 0,
        options:     s.options ?? null,
        minValue:    s.minValue ?? null,
        maxValue:    s.maxValue ?? null,
        placeholder: s.placeholder ?? null,
      })),
    });
  },

  async publish(clinicId: string, id: string): Promise<TemplateRow> {
    const existing = await templateRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
    if (existing.status !== 'draft') throw new AppError('Only draft templates can be published', 409, 'TEMPLATE_NOT_DRAFT');
    if (existing.sections.length === 0) throw new AppError('Cannot publish a template with no sections', 422, 'TEMPLATE_NO_SECTIONS');
    return templateRepository.setStatus(clinicId, id, 'published');
  },

  async retire(clinicId: string, id: string): Promise<TemplateRow> {
    const existing = await templateRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
    if (existing.status !== 'published') throw new AppError('Only published templates can be retired', 409, 'TEMPLATE_NOT_PUBLISHED');
    return templateRepository.setStatus(clinicId, id, 'retired');
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    const existing = await templateRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
    if (existing.status === 'published') throw new AppError('Retire the template before deleting', 409, 'TEMPLATE_PUBLISHED');
    await templateRepository.softDelete(clinicId, id);
  },
};
