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

export function requiredField(field: FieldDef): boolean {
  return field.required === true;
}

/** Недостающие обязательные поля → карточки-вопросы. Строится из реестра полей. */
export function missingFields(fields: readonly FieldDef[], draftFields: Record<string, { value: unknown }>): MissingField[] {
  return fields
    .filter(requiredField)
    .filter((field) => {
      const value = draftFields[field.key]?.value;
      return value === null || value === undefined || value === '';
    })
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

export const finalize: PipelineStep = {
  id: 'finalize',
  title: 'Готовим итог разбора',
  stage: 'finalize',
  order: 900,
  reads: ['fields', 'missing'],
  writes: ['missing'],
  async run(ctx) {
    return { missing: missingFields(ctx.data.fields, ctx.draft.fields) };
  },
};
