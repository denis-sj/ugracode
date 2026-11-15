import type { FieldValue } from '@ugra/contracts';
import type { ReferenceData } from '@ugra/core';
import { findField, settingNumber } from '@ugra/core';

/** Порог уверенности по умолчанию — как в настройках (`confidenceThreshold`). */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
/** Уверенность распознавания, если порт её не вернул. */
export const DEFAULT_VISION_CONFIDENCE = 0.6;
const SYMPTOMS_LIMIT = 200;

/** Код ошибки: `E123`, `0x80070005`, «ошибка 501», `1007-2`. Слово-подсказка обязательна. */
const ERROR_CODE =
  /(?:код\s*(?:ошибки)?|ошибк[аиуы]?|error|err)[^0-9a-zа-я]{0,4}(0x[0-9a-f]+|[a-zа-я]{0,3}[-_]?\d{2,6}(?:[-_]\d{1,6})?)/i;
/** Модель техники: «Модель: HP LaserJet 1102». */
const MODEL = /(?:модель|model)[\s:№-]*([A-Za-zА-Яа-я0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*){0,2})/i;

export interface VisionFieldsInput {
  /** Текст распознавания. */
  text: string;
  confidence: number;
  /** Источник `kind: 'image'` — на него ссылаются цитаты. */
  sourceId: string;
  data: ReferenceData;
  /** Время шага ISO. */
  at: string;
  step: string;
}

/** Первая непустая строка распознавания — то, что заявитель видит на экране. */
export function symptomsOf(text: string): string {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item !== '');
  if (line === undefined) return '';
  return line.length > SYMPTOMS_LIMIT ? `${line.slice(0, SYMPTOMS_LIMIT - 1)}…` : line;
}

/** Поля из текста распознавания: только те, что есть в реестре, и только с цитатой. */
export function fieldsFromVision(input: VisionFieldsInput): Record<string, FieldValue> {
  const { text, sourceId, data, at, step } = input;
  const threshold = settingNumber(data, 'confidenceThreshold', DEFAULT_CONFIDENCE_THRESHOLD);
  const confidence = Math.min(1, Math.max(0, input.confidence));
  const known = data.fields.length > 0;

  const candidates: { key: string; value: string; quote: string }[] = [];
  const symptoms = symptomsOf(text);
  if (symptoms !== '') candidates.push({ key: 'symptoms', value: symptoms, quote: symptoms });

  const error = ERROR_CODE.exec(text);
  const errorCode = error?.[1]?.trim();
  if (error !== null && errorCode !== undefined && errorCode !== '') {
    candidates.push({ key: 'errorCode', value: errorCode, quote: error[0].trim() });
  }

  const modelMatch = MODEL.exec(text);
  const model = modelMatch?.[1]?.trim();
  if (model !== undefined && model !== '')
    candidates.push({ key: 'model', value: model, quote: modelMatch?.[0].trim() ?? model });

  const fields: Record<string, FieldValue> = {};
  for (const candidate of candidates) {
    if (known && !findField(data, candidate.key)) continue;
    fields[candidate.key] = {
      key: candidate.key,
      value: candidate.value,
      confidence,
      quote: { sourceId, text: candidate.quote },
      origin: 'text',
      needsReview: confidence < threshold,
      trace: [{ kind: 'found', step, at, quote: candidate.quote }],
    };
  }
  return fields;
}
