import type { AgentContext, AgentProfile, ReferenceData } from '@ugra/core';
import { dictionaryOptions, findField } from '@ugra/core';
import type { FieldValue, SourceFragment } from '@ugra/contracts';
import { IntakeResult, type IntakeResult as IntakeResultType } from '../contracts';
import { sourceFor, valueProblem, quoteInText } from './rules';

export const INTAKE_PROMPT_ID = 'modules/extraction/prompts/intake.v1.md';
export const INTAKE_STEP_ID = 'agent.intake';

/** Шаг кладёт в контекст склеенный текст источников: проверять цитаты нужно по нему, а не только по оригиналу. */
export interface IntakeAgentContext extends AgentContext {
  sourceText?: string;
}

function textOf(ctx: AgentContext): string {
  const sourceText = (ctx as IntakeAgentContext).sourceText;
  if (typeof sourceText === 'string' && sourceText.trim() !== '') return sourceText;
  return ctx.appeal?.originalText ?? '';
}

/** Реестр полей и справочники — в состоянии, чтобы модель не угадывала коды и форматы. */
function stateOf(data: ReferenceData): Record<string, unknown> {
  const dictionaries: Record<string, { code: string; label: string }[]> = {};
  for (const item of data.dictionaries) {
    const bucket = (dictionaries[item.dictionary] ??= []);
    bucket.push({ code: item.code, label: item.label });
  }
  return {
    fields: data.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      dictionary: field.dictionary,
      required: field.required,
      extractHint: field.extractHint,
      pattern: field.pattern,
    })),
    dictionaries,
  };
}

/**
 * Проверки кода после схемы: выдуманные поля и значения вне справочника не принимаются.
 * Ошибки возвращаются модели — она исправляет аргументы и вызывает `submit` снова.
 */
export function checkIntake(result: IntakeResultType, ctx: AgentContext): string[] {
  const problems: string[] = [];
  const text = textOf(ctx);
  const known = ctx.data.fields.length > 0;

  for (const field of result.fields) {
    if (known && !findField(ctx.data, field.key)) {
      problems.push(`поля «${field.key}» нет в реестре`);
      continue;
    }
    if (field.value === null) continue;
    if (!field.quote) {
      problems.push(`поле «${field.key}»: нет цитаты — значение без цитаты не принимается`);
      continue;
    }
    if (!quoteInText(text, field.quote)) {
      problems.push(`поле «${field.key}»: цитаты нет в тексте — «${field.quote}»`);
      continue;
    }
    const def = findField(ctx.data, field.key);
    const problem = valueProblem(def, field.value, ctx.data);
    if (problem) problems.push(`поле «${field.key}»: ${problem}`);
  }

  for (const sign of result.emergency.signs) {
    if (!quoteInText(text, sign.quote)) {
      problems.push(`признак аварии «${sign.sign}»: цитаты нет в тексте — «${sign.quote}»`);
    }
  }

  if (result.clarify) {
    const def = findField(ctx.data, result.clarify.fieldKey);
    if (known && !def) {
      problems.push(`вопрос задан по полю «${result.clarify.fieldKey}», которого нет в реестре`);
    } else if (def?.dictionary) {
      const codes = dictionaryOptions(ctx.data, def.dictionary).map((option) => option.value);
      for (const option of result.clarify.options) {
        if (!codes.includes(option)) {
          problems.push(`вариант «${option}» не из справочника ${def.dictionary}: ${codes.join(', ')}`);
        }
      }
    }
  }

  return problems.slice(0, 20);
}

/** Профиль агента разбора обращения. Инструменты — только чтение ядра: справочники и CMDB. */
export const intakeAgent: AgentProfile<IntakeResultType> = {
  id: 'intake',
  promptId: INTAKE_PROMPT_ID,
  tools: ['dictionary_lookup', 'cmdb_find_equipment', 'cmdb_list_locations'],
  submit: IntakeResult,
  maxSteps: 6,
  async state(ctx) {
    return {
      now: ctx.clock.now().toISOString(),
      appeal: ctx.appeal ? { channel: ctx.appeal.channel, authorId: ctx.appeal.authorId } : undefined,
      ...stateOf(ctx.data),
    };
  },
  check: checkIntake,
};

function rejected(
  key: string,
  quote: string | null,
  sourceId: string,
  confidence: number,
  at: string,
  note: string,
): FieldValue {
  return {
    key,
    value: null,
    confidence,
    quote: quote ? { sourceId, text: quote } : null,
    origin: 'text',
    needsReview: true,
    trace: [{ kind: 'rejected', step: INTAKE_STEP_ID, at, note, quote: quote ?? undefined }],
  };
}

/**
 * Поля агента → `FieldValue`. Значение без подтверждённой цитаты или вне справочника
 * отбрасывается (значение `null`, след `rejected`), а не попадает в заявку.
 */
export function fieldsFromIntake(
  result: IntakeResultType,
  sources: readonly SourceFragment[],
  data: ReferenceData,
  at: string,
  fallbackSourceId: string,
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const candidate of result.fields) {
    const value = candidate.value?.trim() ?? '';
    if (value === '') continue;
    const source = candidate.quote ? sourceFor(sources, candidate.quote) : undefined;
    if (!source) {
      fields[candidate.key] = rejected(
        candidate.key,
        candidate.quote,
        fallbackSourceId,
        candidate.confidence,
        at,
        candidate.quote ? 'цитаты нет в тексте' : 'нет цитаты',
      );
      continue;
    }
    const problem = valueProblem(findField(data, candidate.key), value, data);
    if (problem) {
      fields[candidate.key] = rejected(
        candidate.key,
        candidate.quote,
        source.id,
        candidate.confidence,
        at,
        problem,
      );
      continue;
    }
    fields[candidate.key] = {
      key: candidate.key,
      value,
      confidence: candidate.confidence,
      quote: { sourceId: source.id, text: candidate.quote ?? '' },
      origin: 'text',
      needsReview: false,
      trace: [{ kind: 'found', step: INTAKE_STEP_ID, at, quote: candidate.quote ?? undefined }],
    };
  }
  return fields;
}
