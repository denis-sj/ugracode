import type {
  AskWidget,
  FieldDef,
  FieldOrigin,
  MetaResponse,
  MissingField,
  RunStreamEvent,
  StepRun,
  TicketField,
} from '@ugra/contracts';

/** Чистые функции живого разбора: шаги пайплайна, черновик заявки, вопросы. */

export type StepViewStatus = 'pending' | 'active' | 'done' | 'failed';

export interface AnalysisStepView {
  id: string;
  title: string;
  hint: string;
  status: StepViewStatus;
}

const STEP_TITLES: Record<string, string> = {
  'intake.normalize': 'Читаем обращение',
  'voice.transcribe': 'Расшифровываем звонок',
  'screenshot.read': 'Смотрим скриншот',
  'extraction.fields': 'Извлекаем поля',
  'extraction.ground': 'Проверяем цитаты',
  'clarify.missing': 'Ищем, чего не хватает',
  'emergency.detect': 'Проверяем признаки аварии',
  'mass.detect': 'Ищем похожие обращения',
  'priority.compute': 'Считаем приоритет и срок',
  'routing.recommend': 'Подбираем исполнителя',
  'knowledge.search': 'Ищем в базе знаний',
  'feedback.draft': 'Готовим ответ',
  finalize: 'Собираем итог',
};

const STEP_HINTS: Record<string, string> = {
  'intake.normalize': 'текст, звонок и скриншот — в источники',
  'voice.transcribe': 'речь → текст',
  'screenshot.read': 'картинка → текст',
  'extraction.fields': 'модель предлагает значения',
  'extraction.ground': 'цитаты, справочники, CMDB',
  'clarify.missing': 'обязательные поля под контролем',
  'emergency.detect': 'правила регламента + модель',
  'mass.detect': 'похожие обращения за окно времени',
  'priority.compute': 'матрица «влияние × срочность»',
  'routing.recommend': 'навык, смена, загрузка',
  'knowledge.search': 'статьи и похожие заявки',
  'feedback.draft': 'шаблон или модель',
  finalize: 'статус и итоговая уверенность',
};

/** Человеческое название шага; неизвестный шаг не ломает интерфейс. */
export function stepTitle(stepId: string): string {
  return STEP_TITLES[stepId] ?? 'Разбор обращения';
}

function stepHint(stepId: string): string {
  return STEP_HINTS[stepId] ?? stepId;
}

function stepStatusOf(status: StepRun['status']): StepViewStatus {
  if (status === 'ok' || status === 'fallback') return 'done';
  if (status === 'failed' || status === 'timeout') return 'failed';
  return 'pending';
}

/** Шаги из сохранённого прогона (`GET /api/tickets/:id` → `steps`) — запасной путь без SSE. */
export function stepsFromRuns(steps: readonly StepRun[]): AnalysisStepView[] {
  const seen = new Set<string>();
  const view: AnalysisStepView[] = [];
  for (const step of steps) {
    if (seen.has(step.stepId)) continue;
    seen.add(step.stepId);
    view.push({
      id: step.stepId,
      title: stepTitle(step.stepId),
      hint: step.durationMs ? `${stepHint(step.stepId)} · ${Math.round(step.durationMs)} мс` : stepHint(step.stepId),
      status: stepStatusOf(step.status),
    });
  }
  return view;
}

/** Шаги из событий SSE: `step.started` → активен, `step.completed` → готов. */
export function stepsFromEvents(events: readonly RunStreamEvent[]): AnalysisStepView[] {
  const map = new Map<string, AnalysisStepView>();
  for (const event of events) {
    if (!event.stepId) continue;
    const id = event.stepId;
    if (event.type === 'step.started') {
      map.set(id, {
        id,
        title: stepTitle(id),
        hint: stepHint(id),
        status: 'active',
      });
      continue;
    }
    if (event.type === 'step.completed') {
      const failed = event.status === 'failed' || event.status === 'timeout';
      map.set(id, {
        id,
        title: stepTitle(id),
        hint: event.message ?? stepHint(id),
        status: failed ? 'failed' : 'done',
      });
    }
  }
  return [...map.values()];
}

export interface DraftFieldView {
  key: string;
  label: string;
  group: FieldDef['group'];
  value: string | null;
  confidence: number;
  origin: FieldOrigin;
  needsReview: boolean;
  quote: string | null;
  order: number;
}

function dictionaryLabel(meta: MetaResponse, dictionary: string | undefined, value: string): string {
  if (!dictionary) return value;
  const item = meta.dictionaries.find((entry) => entry.dictionary === dictionary && entry.code === value);
  return item?.label ?? value;
}

function displayValue(meta: MetaResponse, def: FieldDef, value: string | number | null): string | null {
  if (value === null || value === undefined || `${value}`.trim() === '') return null;
  if (def.type === 'dictionary') return dictionaryLabel(meta, def.dictionary, String(value));
  return String(value);
}

/** Поля заявки, соединённые с реестром `/api/meta`: подписи, группы, порядок. */
export function fieldDrafts(fields: readonly TicketField[], meta: MetaResponse): DraftFieldView[] {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  return meta.fields.map((def, index) => {
    const field = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      value: field ? displayValue(meta, def, field.value) : null,
      confidence: field?.confidence ?? 0,
      origin: field?.origin ?? 'none',
      needsReview: field?.needsReview ?? false,
      quote: field?.quote?.text ?? null,
      order: index,
    };
  });
}

export interface MissingQuestionView extends MissingField {
  widget: AskWidget;
}

function requiredNow(def: FieldDef, fields: readonly TicketField[]): boolean {
  if (def.required === true) return true;
  if (typeof def.required === 'object') {
    const category = fields.find((field) => field.fieldKey === 'category')?.value;
    return typeof category === 'string' && def.required.whenCategory.includes(category);
  }
  return false;
}

function optionsFor(meta: MetaResponse, def: FieldDef): Array<{ value: string; label: string; validated: boolean }> {
  const dictionary = def.dictionary ?? def.ask?.optionsFrom;
  if (!dictionary) return [];
  return meta.dictionaries
    .filter((item) => item.dictionary === dictionary)
    .map((item) => ({ value: item.code, label: item.label, validated: true }));
}

/**
 * Очередь карточек-вопросов: обязательные поля без значения, в порядке реестра.
 * Форма — контракт `MissingField` (`source`, `allowUnknown`, `allowFreeText`, `options[].validated`).
 * Логика ответов придёт в задаче 009 — здесь только показ.
 */
export function missingQuestions(fields: readonly TicketField[], meta: MetaResponse): MissingQuestionView[] {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  return meta.fields
    .filter((def) => requiredNow(def, fields))
    .filter((def) => {
      const value = byKey.get(def.key)?.value;
      return value === null || value === undefined || `${value}`.trim() === '';
    })
    .map((def) => ({
      key: def.key,
      label: def.label,
      question: def.ask?.question ?? `Уточните, пожалуйста: ${def.label.toLowerCase()}`,
      widget: def.ask?.widget ?? 'text',
      options: optionsFor(meta, def),
      source: 'template' as const,
      allowUnknown: true,
      allowFreeText: true,
    }));
}
