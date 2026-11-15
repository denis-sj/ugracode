import type { DictionaryItem, FieldDef, FieldOrigin, RunStreamEvent, TicketField } from '@ugra/contracts';

/** Значение поля в чате: серверное или локальный ответ заявителя. */
export interface FieldSnapshot {
  value: string | number | null;
  origin?: FieldOrigin;
  /** Поле помечено «на проверку» — ИИ не уверен, стоит спросить заявителя. */
  needsReview?: boolean;
}

export type FieldValues = Record<string, FieldSnapshot | undefined>;
export type AnswerMap = Record<string, string | null | undefined>;

export interface QuestionOption {
  value: string;
  label: string;
  /** Подпись «Указан в вашем профиле», «Сверено с базой оборудования» и т. п. */
  hint?: string;
}

export interface ChatQuestion {
  key: string;
  label: string;
  question: string;
  options: QuestionOption[];
  /** Подсказка для строки «Свой вариант». */
  placeholder: string;
}

/** Варианты из справочника — только значения этого справочника, в порядке файла. */
export function dictionaryOptions(
  dictionaries: readonly DictionaryItem[],
  dictionary: string | undefined,
): QuestionOption[] {
  if (!dictionary) return [];
  return dictionaries
    .filter((item) => item.dictionary === dictionary)
    .map((item) => ({ value: item.code, label: item.label }));
}

/** Код справочника → человеческая подпись; неизвестный код возвращаем как есть. */
export function dictionaryLabel(
  dictionaries: readonly DictionaryItem[],
  dictionary: string | undefined,
  code: string | number | null | undefined,
): string | null {
  if (code === null || code === undefined || `${code}`.trim() === '') return null;
  if (!dictionary) return String(code);
  const found = dictionaries.find((item) => item.dictionary === dictionary && item.code === String(code));
  return found?.label ?? String(code);
}

/**
 * Подпись под вариантом по происхождению значения (3.5). Профиль и база оборудования
 * подписываются словами, «из текста» уже объясняет себя в поле заявки.
 */
export function optionHint(origin: FieldOrigin | undefined): string | undefined {
  if (origin === 'profile') return 'Указан в вашем профиле';
  if (origin === 'cmdb') return 'Сверено с базой оборудования';
  if (origin === 'text') return 'Указано в обращении';
  if (origin === 'human') return 'Исправил диспетчер';
  return undefined;
}

function isRequired(def: FieldDef): boolean {
  return def.required === true || typeof def.required === 'object';
}

function isEmpty(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || `${value}`.trim() === '';
}

/** Все значения полей: серверные, поверх них — ответы, данные в чате. */
export function fieldValues(fields: readonly TicketField[], answers: AnswerMap = {}): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    values[field.fieldKey] = { value: field.value, origin: field.origin, needsReview: field.needsReview };
  }
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined) continue;
    values[key] = { value, origin: 'asked', needsReview: false };
  }
  return values;
}

/**
 * Карточки-вопросы: недостающие обязательные поля и поля, в которых ИИ не уверен
 * (`needsReview`). Один вопрос на поле, не больше трёх вариантов; «свой вариант»
 * и «не знаю» добавляет компонент.
 * `answered` — поля, на которые уже ответили (в том числе «не знаю»), их повторно не спрашиваем.
 */
export function buildQuestions(
  fields: readonly FieldDef[],
  dictionaries: readonly DictionaryItem[],
  values: FieldValues,
  answered: ReadonlySet<string> = new Set(),
): ChatQuestion[] {
  const questions: ChatQuestion[] = [];
  for (const def of fields) {
    if (!def.ask || !isRequired(def)) continue;
    if (answered.has(def.key)) continue;
    const snapshot = values[def.key];
    const filled = !isEmpty(snapshot?.value);
    if (filled && snapshot?.needsReview !== true) continue;

    const fromDictionary = dictionaryOptions(dictionaries, def.ask.optionsFrom);
    // Подтверждать свободным текстом то, что ИИ уже нашёл, — лишний вопрос: такие поля оставляем диспетчеру.
    if (filled && fromDictionary.length === 0) continue;
    const current =
      filled && snapshot?.value !== null && snapshot?.value !== undefined ? `${snapshot.value}` : null;
    const currentOption =
      current === null ? undefined : fromDictionary.find((option) => option.value === current);
    const pool = currentOption
      ? [currentOption, ...fromDictionary.filter((option) => option.value !== currentOption.value)]
      : fromDictionary;

    const options = pool.slice(0, 3).map((option) => {
      if (current !== null && option.value === current) {
        return { ...option, hint: 'ИИ предлагает — подтвердите' };
      }
      const match = Object.values(values).find(
        (candidate) =>
          candidate?.value !== null &&
          candidate?.value !== undefined &&
          `${candidate.value}` === option.value,
      );
      const hint = optionHint(match?.origin);
      return hint ? { ...option, hint } : option;
    });

    questions.push({
      key: def.key,
      label: def.label,
      question: def.ask.question,
      options,
      placeholder: def.type === 'text' ? 'Свой вариант, например: шумит и мигает' : 'Свой вариант',
    });
  }
  return questions;
}

/** Строка «Свой вариант»: пустая строка — это «не ответил», а не значение. */
export function ownAnswer(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed;
}

/** Разбор `**жирного**` из ответа модели в сегменты для `<strong>`. */
export interface TextSegment {
  text: string;
  strong: boolean;
}

export function parseEmphasis(text: string): TextSegment[] {
  if (text === '') return [];
  const segments: TextSegment[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), strong: false });
    }
    segments.push({ text: match[1] ?? '', strong: true });
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), strong: false });
  }
  return segments;
}

function bold(value: string): string {
  return `**${value}**`;
}

export interface SummaryInput {
  fields: FieldValues;
  fieldsMeta: readonly FieldDef[];
  dictionaries: readonly DictionaryItem[];
}

function fieldText(values: FieldValues, key: string): string | null {
  const value = values[key]?.value;
  if (value === null || value === undefined) return null;
  const text = `${value}`.trim();
  return text === '' ? null : text;
}

export function formatPlace(input: SummaryInput): string | null {
  const cabinet = fieldText(input.fields, 'cabinet');
  const building = dictionaryLabel(input.dictionaries, 'building', fieldText(input.fields, 'building'));
  if (cabinet && building) return `кабинет ${cabinet}, корпус ${building.replace(/^Корпус\s*/i, '')}`;
  if (cabinet) return `кабинет ${cabinet}`;
  if (building) return building.toLowerCase();
  return null;
}

/** То же место, но в предложении: «в кабинете 312, корпус Б». */
export function formatPlaceIn(input: SummaryInput): string | null {
  const cabinet = fieldText(input.fields, 'cabinet');
  const building = dictionaryLabel(input.dictionaries, 'building', fieldText(input.fields, 'building'));
  const shortBuilding = building?.replace(/^Корпус\s*/i, '') ?? null;
  if (cabinet && shortBuilding) return `в кабинете ${cabinet}, корпус ${shortBuilding}`;
  if (cabinet) return `в кабинете ${cabinet}`;
  if (shortBuilding) return `в корпусе ${shortBuilding}`;
  if (building) return `в ${building.toLowerCase()}`;
  return null;
}

function equipmentText(input: SummaryInput): string | null {
  return fieldText(input.fields, 'model') ?? fieldText(input.fields, 'equipment');
}

function categoryText(input: SummaryInput): string | null {
  return dictionaryLabel(input.dictionaries, 'category', fieldText(input.fields, 'category'));
}

/** «не печатает» → «Не печатает»: заголовок заявки не должен начинаться со строчной. */
export function capitalizeFirst(text: string): string {
  if (text === '') return text;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Название заявки для списка: симптом → объект → категория → «Обращение». */
export function ticketTitle(input: SummaryInput): string {
  const symptoms = fieldText(input.fields, 'symptoms');
  if (symptoms) {
    return capitalizeFirst(symptoms.length > 80 ? `${symptoms.slice(0, 78)}…` : symptoms);
  }
  const object = fieldText(input.fields, 'object');
  if (object) return capitalizeFirst(object);
  const category = categoryText(input);
  if (category) return category;
  return 'Обращение';
}

/**
 * Первый ответ ИИ после разбора: обычный текст, ключевое — жирным.
 * Никаких выдуманных номеров и сроков: всё из полей заявки.
 */
export function buildAiSummary(input: SummaryInput & { questions?: number }): string {
  const equipment = equipmentText(input);
  const place = formatPlaceIn(input);
  const symptom = fieldText(input.fields, 'symptoms');
  const what = equipment ?? categoryText(input) ?? fieldText(input.fields, 'object');

  const parts: string[] = [];
  if (what) parts.push(bold(what));
  if (place) parts.push(bold(place));
  if (symptom && symptom !== what) parts.push(bold(symptom));

  /** Что осталось: без вопросов — заявка готова, с одним — «один вопрос». */
  const tail = ((): string => {
    const count = input.questions;
    if (count === 0) return 'Заявка собрана — проверьте её справа.';
    if (count === 1) return 'Один вопрос — и заявка готова.';
    if (count !== undefined && count > 1) return `Ещё ${count} вопроса — и заявка готова.`;
    return 'Уточню детали — заявка справа собирается по ходу.';
  })();

  if (parts.length === 0) {
    return `Разобрала обращение. ${tail}`;
  }

  const found = equipment ? ' Оборудование нашла в базе.' : '';
  return `Поняла: ${parts.join(', ')}.${found} ${tail}`;
}

export type StickerTone = 'ok' | 'wait' | 'accent';

export interface StickerRow {
  key: string;
  label: string;
  value: string;
  tone: StickerTone;
  /** Подпись происхождения значения: «из вашего текста», «оценил ИИ», «ждём ваш ответ». */
  source?: { text: string; tone: 'accent' | 'info' | 'ok' | 'warn' | 'dim' };
}

export interface StickerInput extends SummaryInput {
  assigneeName?: string | null;
  due?: string | null;
  /** Ответы в чате: `null` — «не знаю»/пропуск, поле уточнит диспетчер. */
  answers?: AnswerMap;
  /** Происхождение полей заявки (`TicketField.origin`): подпись под значением. */
  origins?: Record<string, string>;
}

/** Поля стикера «Ваше обращение»: заполненные — графитом, ожидающие — серым. */
export function stickerRows(input: StickerInput): StickerRow[] {
  const equipment = equipmentText(input);
  const place = formatPlace(input);
  const symptom = fieldText(input.fields, 'symptoms') ?? fieldText(input.fields, 'object');
  const urgency = dictionaryLabel(input.dictionaries, 'urgency', fieldText(input.fields, 'urgency'));
  const answered = input.answers ?? {};

  const unknown = (keys: readonly string[]): boolean => keys.some((key) => answered[key] === null);
  const valueOr = (value: string | null, waitText: string, keys: readonly string[]): string => {
    if (value) return value;
    return unknown(keys) ? 'уточнит диспетчер' : waitText;
  };

  /** Подпись происхождения: поле из заявки → его origin, иначе «ждём ваш ответ»/«оценил ИИ». */
  const source = (
    keys: readonly string[],
    value: string | null,
    fallback: 'wait' | 'ai',
  ): StickerRow['source'] => {
    if (value === null) {
      return keys.some((key) => answered[key] === null)
        ? { text: 'ответ заявителя', tone: 'info' }
        : { text: 'ждём ваш ответ', tone: 'warn' };
    }
    const origins = input.origins ?? {};
    const key = keys.find((candidate) => origins[candidate]);
    if (key) {
      const origin = origins[key];
      if (origin === 'asked') return { text: 'ответ заявителя', tone: 'info' };
      if (origin === 'cmdb') return { text: 'сверено с базой', tone: 'ok' };
      if (origin === 'human') return { text: 'исправил диспетчер', tone: 'ok' };
      if (origin === 'profile') return { text: 'из профиля', tone: 'accent' };
      return { text: 'из вашего текста', tone: 'accent' };
    }
    return fallback === 'ai' ? { text: 'оценил ИИ', tone: 'info' } : { text: 'из вашего текста', tone: 'accent' };
  };

  const rows: StickerRow[] = [
    {
      key: 'equipment',
      label: 'Оборудование',
      value: valueOr(equipment, 'уточняем…', ['equipment', 'model']),
      tone: equipment ? 'ok' : 'wait',
      source: source(['equipment', 'model'], equipment, 'wait'),
    },
    {
      key: 'place',
      label: 'Место',
      value: valueOr(place, 'уточняем…', ['building', 'cabinet']),
      tone: place ? 'ok' : 'wait',
      source: source(['building', 'cabinet'], place, 'wait'),
    },
    {
      key: 'symptom',
      label: 'Признак',
      value: valueOr(symptom, 'уточняем…', ['symptoms', 'object']),
      tone: symptom ? 'ok' : 'wait',
      source: source(['symptoms', 'object'], symptom, 'wait'),
    },
    {
      key: 'urgency',
      label: 'Срочность',
      value: valueOr(urgency, 'уточняем…', ['urgency']),
      tone: urgency ? 'ok' : 'wait',
      source: source(['urgency'], urgency, 'ai'),
    },
  ];
  if (input.assigneeName) {
    const due = input.due ? `, ${input.due}` : '';
    rows.push({
      key: 'assignee',
      label: 'Инженер',
      value: `${input.assigneeName}${due}`,
      tone: 'accent',
      source: { text: 'предложил ИИ', tone: 'info' },
    });
  }
  return rows;
}

/** Сколько вопросов ещё осталось — для «1 из N». */
export function questionCounter(index: number, total: number): string {
  if (total <= 0) return '0 из 0';
  return `${Math.min(index + 1, total)} из ${total}`;
}

/** Стрелки «назад/вперёд» не должны уводить за пределы списка. */
export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (index < 0) return total - 1;
  if (index >= total) return 0;
  return index;
}

/* ---------- Разбор из `GET /api/tickets/:id/analysis` ---------- */

export interface MissingQuestionOption {
  value: string;
  label: string;
}

export interface MissingQuestion {
  key: string;
  label: string;
  question: string;
  options: MissingQuestionOption[];
}

export interface EmergencyView {
  level: 'suspected' | 'confirmed';
  /** Уверенность 0…1, в интерфейсе — проценты. */
  confidence: number;
  /** Цитаты-признаки из обращения. */
  signs: string[];
}

export interface AnalysisView {
  missing: MissingQuestion[];
  emergency: EmergencyView | null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function optionsOf(value: unknown): MissingQuestionOption[] {
  if (!Array.isArray(value)) return [];
  const options: MissingQuestionOption[] = [];
  for (const raw of value) {
    const item = recordOf(raw);
    const optionValue = item ? textOf(item.value) : null;
    const optionLabel = item ? textOf(item.label) : null;
    if (optionValue && optionLabel && !options.some((option) => option.value === optionValue)) {
      options.push({ value: optionValue, label: optionLabel });
    }
  }
  return options;
}

function missingOf(value: unknown): MissingQuestion | null {
  const item = recordOf(value);
  const key = item ? textOf(item.key) : null;
  const question = item ? textOf(item.question) : null;
  if (!item || !key || !question) return null;
  return { key, label: textOf(item.label) ?? key, question, options: optionsOf(item.options) };
}

function signsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const signs: string[] = [];
  for (const raw of value) {
    const item = recordOf(raw);
    const sign = item ? textOf(item.quote) ?? textOf(item.sign) : textOf(raw);
    if (sign && !signs.includes(sign)) signs.push(sign);
  }
  return signs;
}

function emergencyOf(value: unknown): EmergencyView | null {
  const item = recordOf(value);
  const level = item ? textOf(item.level) : null;
  if (level !== 'suspected' && level !== 'confirmed') return null;
  const rawConfidence = item?.confidence;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0;
  return { level, confidence, signs: signsOf(item?.signs) };
}

/** Терпимо разбирает `analysis` из ответа API: битое поле не роняет экран. */
export function parseAnalysis(raw: Record<string, unknown> | null | undefined): AnalysisView {
  const missingRaw = raw ? raw.missing : undefined;
  const missing = Array.isArray(missingRaw)
    ? missingRaw.map(missingOf).filter((item): item is MissingQuestion => item !== null)
    : [];
  return { missing, emergency: raw ? emergencyOf(raw.emergency) : null };
}

export interface EmergencyBadge {
  text: string;
  title: string;
}

/** Плашка аварии для стикера: уровень и уверенность в процентах, цитата — в подсказке. */
export function emergencyBadge(analysis: AnalysisView | null | undefined): EmergencyBadge | null {
  const emergency = analysis?.emergency;
  if (!emergency) return null;
  const percent = Math.round(emergency.confidence * 100);
  const text = emergency.level === 'confirmed' ? `Авария · ${percent}%` : `Возможна авария · ${percent}%`;
  const quote = emergency.signs[0];
  return { text, title: quote ? `${text}. Признак: «${quote}»` : text };
}

export interface QuestionsInput {
  fields: readonly FieldDef[];
  dictionaries: readonly DictionaryItem[];
  values: FieldValues;
  answered?: ReadonlySet<string>;
  analysis?: AnalysisView | null;
}

function missingToQuestion(
  item: MissingQuestion,
  fields: readonly FieldDef[],
  dictionaries: readonly DictionaryItem[],
): ChatQuestion {
  const def = fields.find((field) => field.key === item.key);
  const placeholder = def?.type === 'text' ? 'Свой вариант, например: шумит и мигает' : 'Свой вариант';
  // Варианты модели важнее; если их меньше двух, добираем значениями справочника —
  // карточка без выбора («Не знаю» и «Свой вариант») бесполезна на защите.
  const fromDictionary = dictionaryOptions(dictionaries, def?.ask?.optionsFrom);
  const seen = new Set(item.options.map((option) => option.value));
  const options = [...item.options];
  for (const option of fromDictionary) {
    if (options.length >= 3) break;
    if (seen.has(option.value)) continue;
    options.push(option);
  }
  return {
    key: item.key,
    label: item.label,
    question: item.question,
    options: options.slice(0, 3),
    placeholder,
  };
}

/**
 * Вопросы из анализа (`missing`) важнее шаблонов реестра: их формулирует модель.
 * Если `missing` нет — работает прежняя клиентская сборка из `GET /api/meta`.
 * Ответы, которые уже дали, повторно не спрашиваем.
 */
export function questionsFor(input: QuestionsInput): ChatQuestion[] {
  const answered = input.answered ?? new Set<string>();
  if (input.analysis && input.analysis.missing.length > 0) {
    return input.analysis.missing
      .filter((item) => !answered.has(item.key))
      .map((item) => missingToQuestion(item, input.fields, input.dictionaries));
  }
  return buildQuestions(input.fields, input.dictionaries, input.values, answered);
}

/* ---------- Поток разбора (SSE) ---------- */

export type RunStepStatus = 'started' | 'progress' | 'completed' | 'failed';

export interface RunStepView {
  stepId: string;
  label: string;
  status: RunStepStatus;
  message?: string;
}

export interface RunTraceView {
  n: number;
  tool?: string;
  label: string;
  summary?: string;
  durationMs: number;
  status: 'running' | 'done' | 'blocked' | 'error';
}

export interface RunProgressView {
  steps: RunStepView[];
  /** Журнал работы ИИ: вызовы инструментов по порядку. */
  trace: RunTraceView[];
  /** Текущая подпись для перелива; `null` — шаг закончился. */
  current: string | null;
  finished: boolean;
  failed: boolean;
  /** Когда начался разбор: для «Разобрал за N с». */
  startedAt: number;
  /** Сколько шёл разбор; заполняется при завершении. */
  elapsedMs?: number;
}

/** Человеческие подписи шагов пайплайна: в SSE приходит только `stepId`. */
export const RUN_STEP_LABELS: Readonly<Record<string, string>> = {
  'intake.normalize': 'Собираем текст обращения',
  'agent.intake': 'Разбираем обращение',
  'extraction.ground': 'Проверяем цитаты и технику',
  'profile.prefill': 'Смотрим профиль и место',
  'priority.compute': 'Считаем приоритет',
  'routing.recommend': 'Подбираем исполнителя',
  'emergency.detect': 'Проверяем признаки аварии',
  finalize: 'Готовим итог разбора',
};

/**
 * Одно название шага — одна строка: агент может повторять подпись в каждом вызове,
 * в раскрытом журнале она должна встречаться один раз (побеждает последний статус).
 */
export function uniqueStepsByLabel(steps: readonly { label: string }[]): { label: string }[] {
  const seen = new Map<string, { label: string }>();
  for (const step of steps) {
    const key = step.label.trim().toLowerCase();
    if (key === '') continue;
    seen.set(key, step);
  }
  return [...seen.values()];
}

export function runStepLabel(stepId: string | undefined): string {
  if (!stepId) return 'Разбираем обращение';
  return RUN_STEP_LABELS[stepId] ?? 'Обрабатываем обращение';
}

export function initialRunProgress(now = Date.now()): RunProgressView {
  return { steps: [], trace: [], current: null, finished: false, failed: false, startedAt: now };
}

/** «12 с» / «1,2 с» — время шага и всего разбора. */
export function formatRunDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} мс`;
  const seconds = ms / 1000;
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1).replace('.', ',')} с`;
}

function upsertTrace(trace: readonly RunTraceView[], next: RunTraceView): RunTraceView[] {
  const index = trace.findIndex((item) => item.n === next.n);
  if (index < 0) return [...trace, next];
  return trace.map((item, position) =>
    position === index ? { ...item, ...next, summary: next.summary ?? item.summary } : item,
  );
}

export function agentStepView(event: RunStreamEvent): RunTraceView | null {
  if (event.type !== 'agent.step' || !event.n || !event.label) return null;
  return {
    n: event.n,
    tool: event.tool,
    label: event.label,
    summary: event.summary,
    durationMs: event.durationMs ?? 0,
    status: (event.status as RunTraceView['status']) ?? 'running',
  };
}

function upsertStep(steps: readonly RunStepView[], next: RunStepView): RunStepView[] {
  const index = steps.findIndex((step) => step.stepId === next.stepId);
  if (index < 0) return [...steps, next];
  return steps.map((step, position) =>
    position === index ? { ...step, ...next, message: next.message ?? step.message } : step,
  );
}

function stepEvent(
  state: RunProgressView,
  event: RunStreamEvent,
  status: RunStepStatus,
): RunProgressView {
  if (!event.stepId) return state;
  const message = textOf(event.message) ?? undefined;
  const label = runStepLabel(event.stepId);
  const step: RunStepView = { stepId: event.stepId, label, status, message };
  return {
    ...state,
    steps: upsertStep(state.steps, step),
    current: status === 'completed' ? null : message ?? label,
  };
}

/**
 * Событие SSE → состояние шагов. История разбора может прийти одним пакетом,
 * поэтому шаги уникальны по `stepId`, а неизвестный тип события ничего не ломает.
 */
export function reduceRunEvent(state: RunProgressView, event: RunStreamEvent): RunProgressView {
  switch (event.type) {
    case 'step.started':
      return stepEvent(state, event, 'started');
    case 'step.progress':
      return stepEvent(state, event, 'progress');
    case 'step.completed':
      return stepEvent(state, event, 'completed');
    case 'agent.step': {
      const trace = agentStepView(event);
      if (!trace) return state;
      return {
        ...state,
        trace: upsertTrace(state.trace, trace),
        current: trace.status === 'running' ? trace.label : state.current,
      };
    }
    case 'run.completed':
      return { ...state, current: null, finished: true, failed: false };
    case 'run.failed':
      return { ...state, current: null, finished: true, failed: true };
    default:
      return state;
  }
}
