import type { FieldDef, MissingField } from '@ugra/contracts';
import type { PipelineStep } from './types';

/** Шаги ядра: нормализация входа и финализация. Предметные шаги — в модулях. */
export function coreSteps(): PipelineStep[] {
  return [intakeNormalize, finalize];
}

export const intakeNormalize: PipelineStep = {
  id: 'intake.normalize',
  title: 'Собираем текст обращения',
  stage: 'intake',
  order: 10,
  reads: ['sources'],
  writes: ['sources'],
  async run(ctx) {
    return {
      sources: [{ id: ctx.appeal.id, kind: 'text', text: ctx.appeal.originalText }],
    };
  },
};

/**
 * Обязательно ли поле при текущих значениях. `{ whenCategory }` — только для перечисленных
 * категорий: оборудование нужно для принтера или ПК, а не для доступа к 1С.
 * Пока категория неизвестна, условное поле не требуем — сначала спросят категорию.
 */
export function requiredField(field: FieldDef, values: Record<string, { value: unknown }> = {}): boolean {
  if (field.required === true) return true;
  if (field.required === false) return false;
  const category = values.category?.value;
  return typeof category === 'string' && field.required.whenCategory.includes(category);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Недостающие обязательные поля → карточки-вопросы. Строится из реестра полей. */
export function missingFields(fields: readonly FieldDef[], draftFields: Record<string, { value: unknown }>): MissingField[] {
  return fields
    .filter((field) => requiredField(field, draftFields))
    .filter((field) => isBlank(draftFields[field.key]?.value))
    .map((field) => ({
      key: field.key,
      label: field.label,
      question: field.ask?.question ?? `Уточните, пожалуйста: ${field.label.toLowerCase()}`,
      widget: field.ask?.widget ?? 'text',
      source: 'template' as const,
      allowUnknown: true,
      allowFreeText: field.ask?.widget === 'text' || field.ask?.widget === 'location',
    }));
}

/**
 * Итоговый список недостающих: вопросы модулей (формулировки модели, порядок важности)
 * сохраняем, шаблоны реестра добавляем только для полей, о которых модули не спросили.
 */
export function keepAsked(
  asked: readonly MissingField[],
  computed: readonly MissingField[],
  draftFields: Record<string, { value: unknown }> = {},
): MissingField[] {
  const stillMissing = asked.filter((item) => isBlank(draftFields[item.key]?.value));
  const known = new Set(stillMissing.map((item) => item.key));
  return [...stillMissing, ...computed.filter((item) => !known.has(item.key))];
}

export const finalize: PipelineStep = {
  id: 'finalize',
  title: 'Готовим итог разбора',
  stage: 'finalize',
  order: 900,
  reads: ['fields', 'missing'],
  writes: ['missing'],
  async run(ctx) {
    return { missing: keepAsked(ctx.draft.missing, missingFields(ctx.data.fields, ctx.draft.fields), ctx.draft.fields) };
  },
};
