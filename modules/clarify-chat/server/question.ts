import type { AppealMessage, ChatCard, FieldDef, MissingField } from '@ugra/contracts';
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

function questionOf(value: unknown): AiQuestion | null {
  const item = asRecord(value);
  const fieldKey = typeof item.fieldKey === 'string' ? item.fieldKey : '';
  const question = typeof item.question === 'string' ? item.question.trim() : '';
  if (fieldKey === '' || question === '') return null;
  const rawOptions = Array.isArray(item.options) ? item.options : [];
  const options = rawOptions
    .filter((option): option is string => typeof option === 'string' && option.trim() !== '')
    .slice(0, MAX_OPTIONS);
  return { fieldKey, question, options };
}

function questionsOf(value: unknown): AiQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.map(questionOf).filter((item): item is AiQuestion => item !== null);
}

/**
 * Вопросы модели в порядке важности из `draft.ext.extraction`: список `questions`,
 * а если его нет — старый одиночный `clarify`. Схема живёт в модуле `extraction`,
 * код чужого модуля не импортируем — читаем только данные.
 */
export function aiQuestionsOf(ext: Record<string, unknown> | undefined): AiQuestion[] {
  const extraction = asRecord(ext?.extraction);
  const list = questionsOf(extraction.questions);
  if (list.length > 0) return list;
  const single = questionOf(extraction.clarify);
  return single ? [single] : [];
}

/**
 * План вопросов из истории чата: повторный разбор после ответа идёт с `validate`
 * и черновик без вопросов модели — план хранится в первой карточке-вопросе.
 */
export function planFromHistory(messages: readonly AppealMessage[]): AiQuestion[] {
  for (const message of messages) {
    if (message.kind !== 'question_card') continue;
    const plan = questionsOf(message.card?.payload.plan);
    if (plan.length > 0) return plan;
  }
  return [];
}

/** Вопрос модели по конкретному полю. */
export function aiQuestionFor(plan: readonly AiQuestion[], fieldKey: string): AiQuestion | null {
  return plan.find((item) => item.fieldKey === fieldKey) ?? null;
}

/** Недостающие поля в порядке важности по модели; поля, о которых она не спросила, — в конце по реестру. */
export function orderByPlan<T extends { key: string }>(missing: readonly T[], plan: readonly AiQuestion[]): T[] {
  const rank = (key: string): number => {
    const index = plan.findIndex((item) => item.fieldKey === key);
    return index === -1 ? plan.length : index;
  };
  return missing
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
    .map(({ item }) => item);
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
  plan: readonly AiQuestion[],
): MissingField {
  const ai = aiQuestionFor(plan, missing.key);
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

/** Содержимое карточки для хранения и интерфейса; `plan` — вопросы модели для следующих раундов. */
export function questionCard(question: MissingField, plan: readonly AiQuestion[] = []): ChatCard {
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
      plan: plan.map((item) => ({ ...item, options: [...item.options] })),
    },
  };
}
