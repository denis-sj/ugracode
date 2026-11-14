import { z } from 'zod';

/** Природная группа поля — используется формой, промптом и отчётом о качестве. */
export const FieldGroup = z.enum(['classification', 'location', 'equipment', 'technical', 'symptoms']);
export type FieldGroup = z.infer<typeof FieldGroup>;

export const FieldType = z.enum(['dictionary', 'string', 'number', 'ip', 'text', 'cmdbRef']);
export type FieldType = z.infer<typeof FieldType>;

export const FieldOrigin = z.enum(['text', 'asked', 'cmdb', 'rule', 'human', 'none']);
export type FieldOrigin = z.infer<typeof FieldOrigin>;

export const TraceKind = z.enum([
  'found',
  'not_found',
  'rejected',
  'matched_cmdb',
  'asked',
  'answered',
  'corrected',
  'computed',
]);
export type TraceKind = z.infer<typeof TraceKind>;

/** Один шаг следа «нашёл → спросил → диспетчеру». */
export const TraceEntry = z.object({
  kind: TraceKind,
  step: z.string(),
  at: z.string(),
  note: z.string().optional(),
  quote: z.string().optional(),
});
export type TraceEntry = z.infer<typeof TraceEntry>;

export const FieldValue = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number()]).nullable(),
  confidence: z.number().min(0).max(1),
  quote: z.object({ sourceId: z.string(), text: z.string() }).nullable(),
  origin: FieldOrigin,
  needsReview: z.boolean(),
  trace: z.array(TraceEntry).default([]),
});
export type FieldValue = z.infer<typeof FieldValue>;

export const AskWidget = z.enum(['buttons', 'select', 'text', 'location']);
export type AskWidget = z.infer<typeof AskWidget>;

export const EvalMode = z.enum(['exact', 'normalized', 'none']);
export type EvalMode = z.infer<typeof EvalMode>;

/** Реестр полей: из одной записи строятся промпт, схема модели, форма и вопрос в чате. */
export const FieldDef = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  group: FieldGroup,
  type: FieldType,
  dictionary: z.string().optional(),
  required: z.union([z.boolean(), z.object({ whenCategory: z.array(z.string()) })]),
  extractHint: z.string(),
  pattern: z.string().optional(),
  ask: z
    .object({
      question: z.string(),
      widget: AskWidget,
      optionsFrom: z.string().optional(),
    })
    .optional(),
  evalMode: EvalMode,
  /** Поле принадлежит модулю (если задано); пусто — базовое поле ядра. */
  moduleId: z.string().optional(),
});
export type FieldDef = z.infer<typeof FieldDef>;

export const FieldsFile = z.object({ fields: z.array(FieldDef) });
export type FieldsFile = z.infer<typeof FieldsFile>;

export const DictionaryItem = z.object({
  dictionary: z.string(),
  code: z.string(),
  label: z.string(),
  parentCode: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type DictionaryItem = z.infer<typeof DictionaryItem>;

export const DictionariesFile = z.object({ items: z.array(DictionaryItem) });
export type DictionariesFile = z.infer<typeof DictionariesFile>;
