import { describe, expect, it } from 'vitest';
import type { Appeal } from '@ugra/contracts';
import { KernelEventBus, MemoryStore, PipelineEngine, coreSteps } from '../src';
import type { Ports } from '../src/ports';
import type { PipelineStep } from '../src/types';
import { createReferenceData } from '../src/data';

const appeal: Appeal = {
  id: 'a-1',
  channel: 'chat',
  authorId: 'u-1',
  originalText: 'Корпус Б, кабинет 312',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

const ports: Ports = {
  llm: {
    structured: async () => Promise.reject(new Error('нет')),
    chat: async () => Promise.reject(new Error('нет')),
  },
  embeddings: { embed: async () => [] },
  speech: { transcribe: async () => ({ text: '' }) },
  vision: { describe: async () => ({ text: '' }) },
  cmdb: { findEquipment: async () => [], locations: async () => [] },
  history: { similar: async () => [] },
  notifications: { send: async () => ({ delivered: true }) },
  clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
};

const cabinetStep: PipelineStep = {
  id: 'test.cabinet',
  title: 'Кабинет',
  stage: 'extract',
  order: 100,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {
      fields: {
        cabinet: {
          key: 'cabinet',
          value: '312',
          confidence: 0.9,
          quote: { sourceId: 'a-1', text: 'кабинет 312' },
          origin: 'text',
          needsReview: false,
          trace: [],
        },
      },
    };
  },
};

function engine(steps: PipelineStep[], overrides: { onProgress?: () => void } = {}): PipelineEngine {
  return new PipelineEngine({
    bus: new KernelEventBus(),
    ports,
    data: createReferenceData(),
    steps,
    onProgress: overrides.onProgress,
  });
}

describe('PipelineEngine', () => {
  it('выполняет шаг и мержит черновик', async () => {
    const result = await engine([...coreSteps(), cabinetStep]).run(appeal);
    expect(result.draft.fields.cabinet?.value).toBe('312');
    expect(result.draft.sources[0]?.text).toContain('кабинет 312');
    expect(result.status).toBe('ok');
    expect(result.steps.map((step) => step.stepId)).toContain('test.cabinet');
  });

  it('вызывает fallback при ошибке шага', async () => {
    const failing: PipelineStep = {
      ...cabinetStep,
      id: 'test.failing',
      async run() {
        throw new Error('сломалось');
      },
      async fallback() {
        return {
          fields: {
            equipment: {
              key: 'equipment',
              value: 'принтер HP',
              confidence: 0.4,
              quote: null,
              origin: 'rule',
              needsReview: true,
              trace: [],
            },
          },
        };
      },
    };
    const result = await engine([failing]).run(appeal);
    expect(result.steps[0]?.status).toBe('fallback');
  });

  it('без fallback шаг падает, разбор идёт дальше', async () => {
    const failing: PipelineStep = {
      id: 'test.failing',
      title: 'Падает',
      stage: 'extract',
      reads: ['sources'],
      writes: ['fields'],
      async run() {
        throw new Error('сломалось');
      },
    };
    const result = await engine([failing, cabinetStep]).run(appeal);
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.draft.fields.cabinet?.value).toBe('312');
  });

  it('прерывает шаг по таймауту', async () => {
    const slow: PipelineStep = {
      id: 'test.slow',
      title: 'Долгий',
      stage: 'extract',
      timeoutMs: 10,
      reads: ['sources'],
      writes: ['fields'],
      run: () => new Promise(() => undefined),
    };
    const result = await engine([slow]).run(appeal);
    expect(result.steps[0]?.status).toBe('timeout');
    expect(result.status).toBe('failed');
  });

  it('идёт с середины при rerun', async () => {
    const result = await engine([...coreSteps(), cabinetStep]).rerun(appeal, 'extract');
    expect(result.steps.map((step) => step.stepId)).not.toContain('intake.normalize');
    expect(result.draft.fields.cabinet?.value).toBe('312');
  });

  it('сохраняет шаги в хранилище', async () => {
    const store = new MemoryStore();
    const pipeline = new PipelineEngine({
      bus: new KernelEventBus(store),
      ports,
      data: createReferenceData(),
      steps: [cabinetStep],
      store,
    });
    await pipeline.run(appeal, { ticketId: 't-1' });
    const steps = await store.listPipelineSteps({ ticketId: 't-1' });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('ok');
  });

  it('сообщает о прогрессе', async () => {
    const events: string[] = [];
    await engine([cabinetStep], { onProgress: () => events.push('progress') }).run(appeal);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
