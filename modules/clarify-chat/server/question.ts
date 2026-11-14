import type { ChatCard, FieldDef, MissingField } from '@ugra/contracts';
import type { ReferenceData } from '@ugra/core';

/** Больше пяти вариантов в карточке не показываем: остальное — «свой ответ». */
const MAX_OPTIONS = 5;

/** Вопрос, который предложила модель в `draft.ext.extraction.clarify`. */
export interface AiQuestion {
  fieldKey: string;
  question: string;
  options: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Вопрос модели по конкретному полю. Читаем только данные `draft.ext.extraction`
 * (схема живёт в модуле `extraction`), код чужого модуля не импортируем.
 */
export function aiQuestionFor(ext: Record<string, unknown> | undefined, fieldKey: string): AiQuestion | null {
  const clarify = asRecord(asRecord(ext?.extraction).clarify);
  if (clarify.fieldKey !== fieldKey) return null;
  const question = typeof clarify.question === 'string' ? clarify.question.trim() : '';
  if (question === '') return null;
  const rawOptions = Array.isArray(clarify.options) ? clarify.options : [];
  const options = rawOptions
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .slice(0, MAX_OPTIONS);
  return { fieldKey, question, options };
}

/** Вариант карточки: `validated` — значение проверено справочником или CMDB. */
type QuestionOption = NonNullable<MissingField['options']>[number];

function optionOf(dictionary: ReferenceData['dictionaries'], code: string): QuestionOption[] {
  const item = dictionary.find((entry) => entry.code === code);
  return item ? [{ value: item.code, label: item.label, validated: true }] : [];
}

/**
 * Варианты карточки: у справочника — только его значения (предложенные моделью отбрасываются,
 * если их нет в справочнике), у свободного поля — варианты модели как есть.
 */
export function optionsFor(
  field: FieldDef | undefined,
  data: ReferenceData,
  aiOptions: readonly string[],
): MissingField['options'] {
  if (field?.dictionary) {
    const dictionary = data.dictionaries.filter((item) => item.dictionary === field.dictionary);
    const codes = new Set(dictionary.map((item) => item.code));
    const proposed = aiOptions.filter((option) => codes.has(option));
    const chosen = proposed.length > 0 ? proposed : dictionary.map((item) => item.code);
    const options = chosen
      .slice(0, MAX_OPTIONS)
      .flatMap((code) => optionOf(dictionary, code));
    return options.length > 0 ? options : undefined;
  }
  const unique = [...new Set(aiOptions)];
  if (unique.length === 0) return undefined;
  // Варианты модели для свободного поля проверкой не подтверждены — помечаем `validated: false`.
  return unique.slice(0, MAX_OPTIONS).map((value) => ({ value, label: value, validated: false }));
}

/**
 * Карточка-вопрос: текст и варианты модели, если она предложила вопрос по этому полю,
 * иначе шаблон из реестра полей. «Не знаю» и свой ответ доступны всегда.
 */
export function buildQuestion(
  missing: MissingField,
  field: FieldDef | undefined,
  data: ReferenceData,
  ext: Record<string, unknown> | undefined,
): MissingField {
  const ai = aiQuestionFor(ext, missing.key);
  const options = optionsFor(field, data, ai?.options ?? []);
  return {
    ...missing,
    question: ai?.question ?? missing.question,
    source: ai ? 'ai' : 'template',
    allowUnknown: true,
    allowFreeText: true,
    ...(options ? { options } : {}),
  };
}

/** Содержимое карточки для хранения и интерфейса. */
export function questionCard(question: MissingField): ChatCard {
  return {
    cardType: 'question',
    payload: {
      fieldKey: question.key,
      label: question.label,
      question: question.question,
      widget: question.widget,
      options: question.options ?? [],
      allowUnknown: question.allowUnknown,
      allowFreeText: question.allowFreeText,
      source: question.source,
    },
  };
}
