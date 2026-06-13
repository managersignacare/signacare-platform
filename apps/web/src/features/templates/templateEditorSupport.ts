import type {
  CreateTemplateDTO,
  SectionOption,
  SectionType,
  TemplateResponse,
  TemplateSection,
  TemplateStatus,
} from './types/templateTypes';

export const TEMPLATE_FIELD_TYPE_OPTIONS: Array<{ value: SectionType; label: string }> = [
  { value: 'heading', label: 'Heading' },
  { value: 'text', label: 'Free Text' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'single_select', label: 'Single Select' },
  { value: 'multi_select', label: 'Multi Select' },
  { value: 'likert', label: 'Likert Scale' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'date', label: 'Date' },
] as const;

function normalizeOptionValue(label: string, fallbackIndex: number): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `option_${fallbackIndex + 1}`;
}

export function createDefaultOptions(labels: string[]): SectionOption[] {
  return labels.map((label, index) => ({
    label,
    value: normalizeOptionValue(label, index),
  }));
}

export function createEmptySection(fieldType: SectionType, position: number): TemplateSection {
  switch (fieldType) {
    case 'heading':
      return {
        label: 'Section heading',
        fieldType,
        position,
        required: false,
        placeholder: 'Describe this section',
      };
    case 'text':
      return {
        label: 'Free text response',
        fieldType,
        position,
        required: false,
        soapField: 'subjective',
        placeholder: 'Enter free-text guidance or response prompt',
      };
    case 'yes_no':
      return {
        label: 'Yes / no question',
        fieldType,
        position,
        required: false,
      };
    case 'single_select':
      return {
        label: 'Single-select question',
        fieldType,
        position,
        required: false,
        options: createDefaultOptions(['Option 1', 'Option 2']),
      };
    case 'multi_select':
      return {
        label: 'Multi-select question',
        fieldType,
        position,
        required: false,
        options: createDefaultOptions(['Option 1', 'Option 2']),
      };
    case 'likert':
      return {
        label: 'Likert-scale question',
        fieldType,
        position,
        required: false,
        minValue: 0,
        maxValue: 5,
      };
    case 'numeric':
      return {
        label: 'Numeric field',
        fieldType,
        position,
        required: false,
        placeholder: 'Enter a number',
      };
    case 'date':
      return {
        label: 'Date field',
        fieldType,
        position,
        required: false,
      };
  }
}

export function cloneSectionsForEdit(template?: TemplateResponse | null): TemplateSection[] {
  return (template?.sections ?? []).map((section, index) => ({
    id: section.id,
    label: section.label,
    fieldType: section.fieldType,
    soapField: section.soapField ?? undefined,
    required: section.required,
    position: index,
    options: section.options ?? undefined,
    minValue: section.minValue ?? undefined,
    maxValue: section.maxValue ?? undefined,
    placeholder: section.placeholder ?? undefined,
  }));
}

export function normalizeTemplateForSave(input: {
  name: string;
  category: string;
  description: string;
  sections: TemplateSection[];
}): CreateTemplateDTO {
  return {
    name: input.name.trim(),
    category: input.category.trim(),
    description: input.description.trim() || undefined,
    sections: input.sections.map((section, index) => ({
      ...section,
      label: section.label.trim(),
      soapField: section.soapField || undefined,
      position: index,
      placeholder: section.placeholder?.trim() || undefined,
      options: section.options
        ?.map((option, optionIndex) => ({
          label: option.label.trim(),
          value: option.value?.trim() || normalizeOptionValue(option.label, optionIndex),
          score: option.score,
        }))
        .filter((option) => option.label.length > 0),
      minValue: section.minValue,
      maxValue: section.maxValue,
    })),
  };
}

export function filterTemplates(input: {
  templates: TemplateResponse[];
  status?: TemplateStatus | '';
  category?: string;
  query?: string;
}): TemplateResponse[] {
  const query = input.query?.trim().toLowerCase() ?? '';
  const category = input.category?.trim().toLowerCase() ?? '';

  return input.templates.filter((template) => {
    if (input.status && template.status !== input.status) return false;
    if (category && template.category.toLowerCase() !== category) return false;
    if (!query) return true;

    return [
      template.name,
      template.description ?? '',
      template.category,
    ].some((value) => value.toLowerCase().includes(query));
  });
}

export function buildTemplateCategoryList(input: {
  managedCategories?: string[];
  currentCategory?: string;
}): string[] {
  const categories = new Set<string>();
  const normalizedManagedCategories = (input.managedCategories ?? [])
    .map((category) => category.trim())
    .filter(Boolean);

  for (const category of normalizedManagedCategories) {
    categories.add(category);
  }

  const currentCategory = input.currentCategory?.trim();
  if (currentCategory) categories.add(currentCategory);

  return Array.from(categories).sort((left, right) => left.localeCompare(right));
}
