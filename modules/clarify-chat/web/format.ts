import type { DictionaryItem, FieldDef, FieldOrigin, TicketField } from '@ugra/contracts';

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
export function buildAiSummary(input: SummaryInput): string {
  const equipment = equipmentText(input);
  const place = formatPlaceIn(input);
  const symptom = fieldText(input.fields, 'symptoms');
  const what = equipment ?? categoryText(input) ?? fieldText(input.fields, 'object');

  const parts: string[] = [];
  if (what) parts.push(bold(what));
  if (place) parts.push(bold(place));
  if (symptom && symptom !== what) parts.push(bold(symptom));

  if (parts.length === 0) {
    return 'Разобрала обращение. Уточню пару деталей — заявка справа собирается по ходу.';
  }

  const found = equipment ? ' Оборудование нашла в базе.' : '';
  return `Поняла: ${parts.join(', ')}.${found} Пара уточнений — заявка справа собирается по ходу.`;
}

export type StickerTone = 'ok' | 'wait' | 'accent';

export interface StickerRow {
  key: string;
  label: string;
  value: string;
  tone: StickerTone;
}

export interface StickerInput extends SummaryInput {
  assigneeName?: string | null;
  due?: string | null;
  /** Ответы в чате: `null` — «не знаю»/пропуск, поле уточнит диспетчер. */
  answers?: AnswerMap;
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

  const rows: StickerRow[] = [
    {
      key: 'equipment',
      label: 'Оборудование',
      value: valueOr(equipment, 'уточняем…', ['equipment', 'model']),
      tone: equipment ? 'ok' : 'wait',
    },
    {
      key: 'place',
      label: 'Место',
      value: valueOr(place, 'уточняем…', ['building', 'cabinet']),
      tone: place ? 'ok' : 'wait',
    },
    {
      key: 'symptom',
      label: 'Признак',
      value: valueOr(symptom, 'уточняем…', ['symptoms', 'object']),
      tone: symptom ? 'ok' : 'wait',
    },
    {
      key: 'urgency',
      label: 'Срочность',
      value: valueOr(urgency, 'уточняем…', ['urgency']),
      tone: urgency ? 'ok' : 'wait',
    },
  ];
  if (input.assigneeName) {
    const due = input.due ? `, ${input.due}` : '';
    rows.push({ key: 'assignee', label: 'Инженер', value: `${input.assigneeName}${due}`, tone: 'accent' });
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
