import type { FieldDef, SourceFragment } from '@ugra/contracts';
import type { ReferenceData } from '@ugra/core';
import { dictionaryOptions, findField } from '@ugra/core';

/**
 * Правила проверки результата модели — код, не модель (раздел 5.1 спецификации ядра).
 * Используются и в `check()` агента (ошибки возвращаются модели), и в шаге `extraction.ground`.
 */

/** Сравнение цитат и значений: без регистра, «ё → е», лишних пробелов. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function quoteInText(text: string, quote: string): boolean {
  const needle = normalizeText(quote);
  return needle.length > 0 && normalizeText(text).includes(needle);
}

/** Склеенный текст всех источников черновика. */
export function sourcesText(sources: readonly SourceFragment[]): string {
  return sources.map((source) => source.text).join('\n');
}

/** Источник, в котором дословно встретилась цитата. */
export function sourceFor(sources: readonly SourceFragment[], quote: string): SourceFragment | undefined {
  return sources.find((source) => quoteInText(source.text, quote));
}

export function fieldValueText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function patternMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true; // битый шаблон в данных не должен отбрасывать правильное значение
  }
}

/**
 * Проверка значения по реестру: справочник (`dictionary`) и формат (`pattern`).
 * Возвращает текст проблемы или `null`, если значение годится.
 */
export function valueProblem(def: FieldDef | undefined, value: string, data: ReferenceData): string | null {
  if (!def) return 'поля нет в реестре полей';
  if (def.dictionary) {
    const codes = dictionaryOptions(data, def.dictionary).map((option) => option.value);
    if (!codes.includes(value)) {
      return `значение «${value}» не из справочника ${def.dictionary}: ${codes.join(', ')}`;
    }
  }
  if (def.pattern && !patternMatches(def.pattern, value)) {
    return `значение «${value}» не подходит под шаблон ${def.pattern}`;
  }
  return null;
}

/** Проблемы одного поля результата агента: реестр, цитата, справочник, формат. */
export function fieldProblems(
  field: { key: string; value: string | null; quote: string | null },
  text: string,
  data: ReferenceData,
): string[] {
  const def = findField(data, field.key);
  const problems: string[] = [];
  if (data.fields.length > 0 && !def) {
    problems.push(`поля «${field.key}» нет в реестре`);
    return problems;
  }
  if (field.value === null) return problems;
  if (!field.quote) {
    problems.push(`поле «${field.key}»: нет цитаты — значение без цитаты не принимается`);
    return problems;
  }
  if (!quoteInText(text, field.quote)) {
    problems.push(`поле «${field.key}»: цитаты нет в тексте — «${field.quote}»`);
    return problems;
  }
  const problem = valueProblem(def, field.value, data);
  if (problem) problems.push(`поле «${field.key}»: ${problem}`);
  return problems;
}
