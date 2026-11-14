import { describe, expect, it } from 'vitest';
import type { AnalysisDraft, FieldDef } from '@ugra/contracts';
import type { Ports, StepContext } from '@ugra/core';
import { createReferenceData } from '@ugra/core';
import { makeAppeal, makeDraft, makePorts } from '@ugra/testkit';
import screenshot, { SCREENSHOT_STEP_ID, VISION_PROMPT_ID, visionAgent } from '../server';

const NOW = new Date(2026, 10, 14, 10, 0, 0);
const appeal = makeAppeal({ id: 'appeal-shot' });

const FIELDS: FieldDef[] = [
  {
    key: 'symptoms',
    label: 'Симптомы',
    group: 'symptoms',
    type: 'text',
    required: false,
    extractHint: 'что видит заявитель',
    evalMode: 'none',
  },
  {
    key: 'errorCode',
    label: 'Код ошибки',
    group: 'technical',
    type: 'string',
    required: false,
    extractHint: 'код ошибки с экрана',
    evalMode: 'exact',
  },
  {
    key: 'model',
    label: 'Модель',
    group: 'equipment',
    type: 'string',
    required: false,
    extractHint: 'модель техники',
    evalMode: 'normalized',
  },
];

const data = createReferenceData({ fields: FIELDS, settings: { confidenceThreshold: 0.75 } });

const IMAGE_SOURCE = {
  id: 'photo-1',
  kind: 'image' as const,
  text: 'data:image/png;base64,AAAA',
  label: 'image/png',
};

function fixedPorts(describe: Ports['vision']['describe']): Ports {
  return { ...makePorts(), vision: { describe }, clock: { now: () => NOW } };
}

function context(draft: AnalysisDraft, ports: Ports): StepContext {
  return {
    runId: 'run-shot',
    appeal,
    draft,
    ports,
    data,
    progress: () => undefined,
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

const step = screenshot.steps.find((item) => item.id === SCREENSHOT_STEP_ID);

function visionReturning(text: string, confidence = 0.9): Ports['vision']['describe'] {
  return async () => ({ text, confidence });
}

describe('screenshot: шаг screenshot.read', () => {
  it('без картинки в источниках шаг ничего не меняет', async () => {
    let called = false;
    const ports = fixedPorts(async () => {
      called = true;
      return { text: 'не должно вызываться' };
    });

    const patch = await step?.run(context(makeDraft(), ports));

    expect(called).toBe(false);
    expect(patch).toEqual({});
  });

  it('картинка без base64 считается отсутствующей', async () => {
    const draft = makeDraft({
      sources: [{ id: 'photo-1', kind: 'image', text: 'data:image/png;base64,  ' }],
    });

    const patch = await step?.run(context(draft, fixedPorts(visionReturning('текст'))));

    expect(patch).toEqual({});
  });

  it('распознаёт картинку: источник image, поля из текста и уверенность', async () => {
    let received: { data: string; mimeType: string } | null = null;
    let promptId = '';
    const ports = fixedPorts(async (image, prompt) => {
      received = { data: image.data, mimeType: image.mimeType };
      promptId = prompt;
      return { text: 'Ошибка E123\nМодель: HP LaserJet 1102\nНе печатает', confidence: 0.9 };
    });
    const draft = makeDraft({ sources: [IMAGE_SOURCE] });

    const patch = await step?.run(context(draft, ports));
    const source = patch?.sources?.find((item) => item.kind === 'image' && item.id !== IMAGE_SOURCE.id);

    expect(received).toEqual({ data: 'AAAA', mimeType: 'image/png' });
    expect(promptId).toBe(VISION_PROMPT_ID);
    expect(source?.text).toContain('Ошибка E123');
    expect(source?.label).toBe('Текст со скриншота');
    expect(patch?.fields?.errorCode).toMatchObject({
      value: 'E123',
      origin: 'text',
      confidence: 0.9,
      needsReview: false,
      quote: { sourceId: source?.id, text: 'Ошибка E123' },
    });
    expect(patch?.fields?.model?.value).toBe('HP LaserJet 1102');
    expect(patch?.fields?.symptoms?.value).toBe('Ошибка E123');
    expect(patch?.ext?.screenshot).toMatchObject({ status: 'recognized', confidence: 0.9 });
  });

  it('низкая уверенность помечает поля на проверку диспетчеру', async () => {
    const draft = makeDraft({ sources: [IMAGE_SOURCE] });
    const ports = fixedPorts(visionReturning('Ошибка 0x80070005', 0.4));

    const patch = await step?.run(context(draft, ports));

    expect(patch?.fields?.errorCode).toMatchObject({ value: '0x80070005', needsReview: true });
  });

  it('ошибка зрения не валит шаг: источник с пометкой «не распознан»', async () => {
    const ports = fixedPorts(async () => {
      throw new Error('нет сети');
    });
    const draft = makeDraft({ sources: [IMAGE_SOURCE] });

    const patch = await step?.run(context(draft, ports));
    const mark = patch?.sources?.at(-1);

    expect(mark).toMatchObject({
      kind: 'image',
      text: 'Скриншот не распознан',
      label: 'Скриншот не распознан',
    });
    expect(patch?.ext?.screenshot).toMatchObject({ status: 'failed', error: 'нет сети' });
    expect(patch?.fields).toBeUndefined();
  });

  it('пустой ответ зрения — тоже «не распознано»', async () => {
    const draft = makeDraft({ sources: [IMAGE_SOURCE] });

    const patch = await step?.run(context(draft, fixedPorts(visionReturning('   '))));

    expect(patch?.sources?.at(-1)?.text).toBe('Скриншот не распознан');
    expect(patch?.ext?.screenshot).toMatchObject({ status: 'failed' });
  });

  it('поля вне реестра не добавляются', async () => {
    const draft = makeDraft({ sources: [IMAGE_SOURCE] });
    const ports = fixedPorts(visionReturning('Ошибка E123\nМодель: HP LaserJet 1102'));
    const onlySymptoms = createReferenceData({ fields: FIELDS.filter((field) => field.key === 'symptoms') });
    const ctx = { ...context(draft, ports), data: onlySymptoms };

    const patch = await step?.run(ctx);

    expect(Object.keys(patch?.fields ?? {})).toEqual(['symptoms']);
  });

  it('агент vision объявлен без инструментов и с промптом', () => {
    expect(visionAgent).toMatchObject({ id: 'vision', promptId: VISION_PROMPT_ID, tools: [] });
  });
});
