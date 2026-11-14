import type { AnalysisDraft, SourceFragment } from '@ugra/contracts';
import type { AgentProfile, DraftPatch, PipelineStep, StepContext } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { VisionSubmit } from '../contracts';
import { DEFAULT_VISION_CONFIDENCE, fieldsFromVision, symptomsOf } from './fields';
import { findImageSource } from './image-source';

export const SCREENSHOT_STEP_ID = 'screenshot.read';
export const VISION_AGENT_ID = 'vision';
export const VISION_PROMPT_ID = 'modules/screenshot/prompts/read.v1.md';

/**
 * Агент `vision` из спецификации харнесса: инструментов нет — вход картинка,
 * итог приходит одним `submit` (`VisionSubmit`). Шаг зовёт порт напрямую,
 * профиль нужен реестру агентов и промпту с версией.
 */
export const visionAgent: AgentProfile<VisionSubmit> = {
  id: VISION_AGENT_ID,
  promptId: VISION_PROMPT_ID,
  tools: [],
  submit: VisionSubmit,
  maxSteps: 1,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withScreenshotExt(draft: Readonly<AnalysisDraft>, value: unknown): AnalysisDraft['ext'] {
  return { ...draft.ext, screenshot: value };
}

/** Пометка «не распознано»: источник, по которому диспетчер увидит причину. */
function notRecognized(ctx: StepContext, source: SourceFragment, error: string): DraftPatch {
  const mark: SourceFragment = {
    id: `${SCREENSHOT_STEP_ID}:${source.id}`,
    kind: 'image',
    text: 'Скриншот не распознан',
    label: 'Скриншот не распознан',
  };
  return {
    sources: [...ctx.draft.sources, mark],
    ext: withScreenshotExt(ctx.draft, { status: 'failed', error }),
  };
}

/**
 * Шаг `screenshot.read` (стадия `enrich`): текст со скриншота ошибки или фото шильдика
 * становится источником `kind: 'image'`, из него сразу достаются симптомы, код ошибки и модель.
 * Картинки нет — шаг ничего не меняет. Ошибка зрения разбор не валит: пометка «не распознано».
 */
const readStep: PipelineStep = {
  id: SCREENSHOT_STEP_ID,
  title: 'Читаем скриншот или шильдик',
  stage: 'enrich',
  order: 100,
  reads: ['sources'],
  writes: ['sources', 'fields'],
  async run(ctx) {
    const image = findImageSource(ctx.draft.sources);
    if (!image) return {};

    const at = ctx.ports.clock.now().toISOString();
    let described;
    try {
      described = await ctx.ports.vision.describe(
        { kind: 'image', data: image.data, mimeType: image.mimeType },
        VISION_PROMPT_ID,
      );
    } catch (error) {
      const message = errorText(error);
      ctx.progress({
        stepId: SCREENSHOT_STEP_ID,
        status: 'failed',
        message: 'Скриншот не распознан — проверит диспетчер',
      });
      return notRecognized(ctx, image.source, message);
    }

    const text = described.text.trim();
    if (text === '') {
      ctx.progress({
        stepId: SCREENSHOT_STEP_ID,
        status: 'failed',
        message: 'На картинке нечего распознать — проверит диспетчер',
      });
      return notRecognized(ctx, image.source, 'пустой ответ зрения');
    }

    const source: SourceFragment = {
      id: `${SCREENSHOT_STEP_ID}:${image.source.id}`,
      kind: 'image',
      text,
      label: 'Текст со скриншота',
    };
    const confidence = described.confidence ?? DEFAULT_VISION_CONFIDENCE;
    const fields = fieldsFromVision({
      text,
      confidence,
      sourceId: source.id,
      data: ctx.data,
      at,
      step: SCREENSHOT_STEP_ID,
    });

    ctx.progress({
      stepId: SCREENSHOT_STEP_ID,
      status: 'progress',
      message: `Распознано: ${symptomsOf(text)}`,
      fields: Object.keys(fields),
    });

    return {
      sources: [...ctx.draft.sources, source],
      fields: { ...ctx.draft.fields, ...fields },
      ext: withScreenshotExt(ctx.draft, { status: 'recognized', sourceId: source.id, confidence }),
    };
  },
};

export default defineModule({
  id: 'screenshot',
  title: 'Скриншот и фото шильдика',
  enabledByDefault: true,
  steps: [readStep],
  agents: [visionAgent],
});
