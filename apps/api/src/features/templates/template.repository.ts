import type { Knex } from 'knex';
import { db } from '../../db/db';

/**
 * @schema-drift-exempt select-aliased
 * All fields are camelCase because the SELECT explicitly aliases
 * snake_case columns (`template_id as templateId`, `field_type as fieldType`,
 * etc.). Guard-exempt — this is the post-SELECT shape, not a DB row.
 */
export interface TemplateSectionRow {
  id:          string;
  templateId:  string;
  label:       string;
  fieldType:   string;
  soapField:   string | null;
  required:    boolean;
  position:    number;
  options:     unknown | null;
  minValue:    number | null;
  maxValue:    number | null;
  placeholder: string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface TemplateRow {
  id:            string;
  clinicId:      string;
  name:          string;
  description:   string | null;
  category:      string;
  status:        string;
  createdById:   string;
  publishedAt:   string | null;
  retiredAt:     string | null;
  createdAt:     string;
  updatedAt:     string;
  sections:      TemplateSectionRow[];
}

/**
 * @schema-drift-exempt select-aliased
 * This is the SELECT-result shape after aliasing snake_case template_categories
 * columns (`clinic_id as clinicId`, `is_active as isActive`, etc.), not the raw
 * DB row contract.
 */
export interface TemplateCategoryRow {
  id: string;
  clinicId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
}

async function hydrateSections(
  templates: Omit<TemplateRow, 'sections'>[],
  q: Knex = db,
): Promise<TemplateRow[]> {
  if (templates.length === 0) return [];
  const ids = templates.map((t) => t.id);
  const rows = await q('template_sections')
    .whereIn('template_id', ids)
    .orderBy('sort_order', 'asc')
    .select([
      'id',
      'template_id   as templateId',
      'label',
      'field_type    as fieldType',
      'soap_field    as soapField',
      'required',
      'position',
      'options',
      'min_value     as minValue',
      'max_value     as maxValue',
      'placeholder',
      'created_at    as createdAt',
      'updated_at    as updatedAt',
    ]);
  const byTemplate = rows.reduce<Record<string, TemplateSectionRow[]>>((acc, r) => {
    (acc[r.templateId] ??= []).push(r as TemplateSectionRow);
    return acc;
  }, {});
  return templates.map((t) => ({ ...t, sections: byTemplate[t.id] ?? [] }));
}

const BASE_COLS = [
  'id',
  'clinic_id       as clinicId',
  'name',
  'description',
  'category',
  'content',
  'status',
  'created_by_id   as createdById',
  'published_at    as publishedAt',
  'retired_at      as retiredAt',
  'created_at      as createdAt',
  'updated_at      as updatedAt',
];

// @column-list-projection-exempt: aliased SELECT projection for template category
// list/read surfaces; not a raw all-columns table mirror.
const CATEGORY_COLS = [
  'id',
  'clinic_id  as clinicId',
  'name',
  'is_active  as isActive',
  'sort_order as sortOrder',
  'created_at as createdAt',
  'updated_at as updatedAt',
];

export const templateRepository = {
  async listCategories(clinicId: string): Promise<TemplateCategoryRow[]> {
    return db('template_categories')
      .where({ clinic_id: clinicId })
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .select(CATEGORY_COLS) as Promise<TemplateCategoryRow[]>;
  },

  async createCategory(
    clinicId: string,
    name: string,
  ): Promise<TemplateCategoryRow> {
    const [row] = await db('template_categories')
      .insert({
        id: db.raw('gen_random_uuid()'),
        clinic_id: clinicId,
        name,
        is_active: true,
        sort_order: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(CATEGORY_COLS);
    return row as TemplateCategoryRow;
  },

  async findCategoryByName(
    clinicId: string,
    name: string,
    excludeId?: string,
  ): Promise<TemplateCategoryRow | undefined> {
    const query = db('template_categories')
      .where({ clinic_id: clinicId })
      .whereRaw('LOWER(name) = LOWER(?)', [name.trim()]);

    if (excludeId) {
      query.andWhereNot({ id: excludeId });
    }

    const row = await query.first(CATEGORY_COLS);
    return row as TemplateCategoryRow | undefined;
  },

  async updateCategory(
    clinicId: string,
    id: string,
    patch: { name?: string; isActive?: boolean; sortOrder?: number },
  ): Promise<TemplateCategoryRow | undefined> {
    return db.transaction(async (trx) => {
      const existing = await trx('template_categories')
        .where({ id, clinic_id: clinicId })
        .first(['id', 'name']);
      if (!existing) return undefined;

      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.isActive !== undefined) update.is_active = patch.isActive;
      if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
      const [row] = await trx('template_categories')
        .where({ id, clinic_id: clinicId })
        .update(update)
        .returning(CATEGORY_COLS);

      if (patch.name !== undefined && patch.name !== existing.name) {
        await trx('templates')
          .where({ clinic_id: clinicId, category: existing.name })
          .whereNull('deleted_at')
          .update({ category: patch.name, updated_at: trx.fn.now() });
      }

      return row as TemplateCategoryRow | undefined;
    });
  },

  async countTemplatesUsingCategory(clinicId: string, categoryName: string): Promise<number> {
    const row = await db('templates')
      .where({ clinic_id: clinicId, category: categoryName })
      .whereNull('deleted_at')
      .count<{ count: string }>('id as count')
      .first();
    return Number(row?.count ?? 0);
  },

  async findCategoryById(clinicId: string, id: string): Promise<TemplateCategoryRow | undefined> {
    const row = await db('template_categories')
      .where({ id, clinic_id: clinicId })
      .first(CATEGORY_COLS);
    return row as TemplateCategoryRow | undefined;
  },

  async deleteCategory(clinicId: string, id: string): Promise<void> {
    await db('template_categories')
      .where({ id, clinic_id: clinicId })
      .delete();
  },

  async list(
    clinicId: string,
    filters: { status?: string; category?: string; q?: string },
  ): Promise<TemplateRow[]> {
    const q = db('templates')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .select(BASE_COLS)
      .orderBy('name', 'asc');
    if (filters.status) q.where('status', filters.status);
    if (filters.category) q.where('category', filters.category);
    if (filters.q) q.whereILike('name', `%${filters.q}%`);
    const rows = await q;
    return hydrateSections(rows as Omit<TemplateRow, 'sections'>[]);
  },

  async findById(
    clinicId: string,
    id: string,
    trx?: Knex.Transaction,
  ): Promise<TemplateRow | undefined> {
    // PR-R1-5 cycle-2: optional `trx` lets transactional callers reuse
    // the transaction's connection (CLAUDE.md §2.1). When omitted, falls
    // back to the pool's default `db`.
    const q = trx ?? db;
    const row = await q('templates')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .select(BASE_COLS)
      .first();
    if (!row) return undefined;
    const [tpl] = await hydrateSections([row as Omit<TemplateRow, 'sections'>], q);
    return tpl;
  },

  async create(
    clinicId: string,
    createdById: string,
    data: {
      name:        string;
      description?: string;
      category:    string;
      sections:    Omit<TemplateSectionRow, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>[];
    },
  ): Promise<TemplateRow> {
    return db.transaction(async (trx) => {
      const [{ id }] = await trx('templates')
        .insert({
          clinic_id:      clinicId,
          created_by_id:  createdById,
          name:           data.name,
          description:    data.description ?? null,
          category:       data.category,
          status:         'draft',
          updated_at:     trx.fn.now(),
        })
        .returning('id');
      if (data.sections.length > 0) {
        // @code-columns-exempt: pre-R2 drift on template_sections: field_type, soap_field, required, position, min_value, max_value, placeholder, updated_at. Baseline 20260701000000 is the fix.
        await trx('template_sections').insert(
          data.sections.map((s, i) => ({
            template_id:  id,
            label:        s.label,
            field_type:   s.fieldType,
            soap_field:   s.soapField ?? null,
            required:     s.required,
            position:     i,
            options:      s.options ? JSON.stringify(s.options) : null,
            min_value:    s.minValue ?? null,
            max_value:    s.maxValue ?? null,
            placeholder:  s.placeholder ?? null,
            updated_at:   trx.fn.now(),
          })),
        );
      }
      const tpl = await templateRepository.findById(clinicId, id, trx);
      if (!tpl) throw new Error('Insert failed');
      return tpl;
    });
  },

  async update(
    clinicId: string,
    id: string,
    data: {
      name?:        string;
      description?: string;
      category?:    string;
      sections?:    Omit<TemplateSectionRow, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>[];
    },
  ): Promise<TemplateRow> {
    return db.transaction(async (trx) => {
      const patch: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (data.name        !== undefined) patch.name        = data.name;
      if (data.description !== undefined) patch.description = data.description;
      if (data.category    !== undefined) patch.category    = data.category;
      await trx('templates').where({ id, clinic_id: clinicId }).update(patch);

      if (data.sections !== undefined) {
        await trx('template_sections').where('template_id', id).delete();
        if (data.sections.length > 0) {
          // @code-columns-exempt: pre-R2 drift on template_sections: field_type, soap_field, required, position, min_value, max_value, placeholder, updated_at. Baseline 20260701000000 is the fix.
          await trx('template_sections').insert(
            data.sections.map((s, i) => ({
              template_id:  id,
              label:        s.label,
              field_type:   s.fieldType,
              soap_field:   s.soapField ?? null,
              required:     s.required,
              position:     i,
              options:      s.options ? JSON.stringify(s.options) : null,
              min_value:    s.minValue ?? null,
              max_value:    s.maxValue ?? null,
              placeholder:  s.placeholder ?? null,
              updated_at:   trx.fn.now(),
            })),
          );
        }
      }
      const tpl = await templateRepository.findById(clinicId, id, trx);
      if (!tpl) throw new Error('Update failed');
      return tpl;
    });
  },

  async setStatus(clinicId: string, id: string, status: 'published' | 'retired'): Promise<TemplateRow> {
    const patch: Record<string, unknown> = { status, updated_at: db.fn.now() };
    if (status === 'published') patch.published_at = db.fn.now();
    if (status === 'retired')   patch.retired_at   = db.fn.now();
    await db('templates').where({ id, clinic_id: clinicId }).whereNull('deleted_at').update(patch);
    const tpl = await templateRepository.findById(clinicId, id);
    if (!tpl) throw new Error('Status update failed');
    return tpl;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db('templates')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: db.fn.now() });
  },
};
