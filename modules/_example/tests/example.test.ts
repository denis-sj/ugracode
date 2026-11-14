import { describe, expect, it } from 'vitest';
import { MemoryStore, createReferenceData, type ModuleDeps } from '@ugra/core';
import type { StepContext } from '@ugra/core';
import example from '../server';

const appeal = {
  id: 'a-1',
  channel: 'chat' as const,
  authorId: 'u-1',
  originalText: 'Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

const data = createReferenceData();

const ports = {
  llm: {
    structured: async () => Promise.reject(new Error('не нужен')),
    chat: async () => Promise.reject(new Error('не нужен')),
  },
  embeddings: { embed: async () => [] },
  speech: { transcribe: async () => ({ text: '' }) },
  vision: { describe: async () => ({ text: '' }) },
  cmdb: { findEquipment: async () => [], locations: async () => [] },
  history: { similar: async () => [] },
  notifications: { send: async () => ({ delivered: true }) },
  clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
};

function context(): StepContext {
  return {
    runId: 'run-1',
    appeal,
    draft: { sources: [{ id: 'a-1', kind: 'text', text: appeal.originalText }], fields: {}, missing: [], ext: {} },
    ports,
    data,
    progress: () => undefined,
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

function deps(): ModuleDeps {
  const store = new MemoryStore();
  return {
    bus: { publish: async () => undefined },
    ports,
    data,
    db: store,
    tickets: { createDraft: async () => Promise.reject(new Error('нет')) } as unknown as ModuleDeps['tickets'],
    settings: { get: async () => undefined },
    clock: ports.clock,
  };
}

describe('модуль example', () => {
  it('извлекает корпус, кабинет и оборудование с цитатами', async () => {
    const step = example.steps[0];
    const patch = await step?.run(context());
    const fields = patch?.fields ?? {};
    expect(fields.building?.value).toBe('Б');
    expect(fields.cabinet?.value).toBe('312');
    expect(fields.equipment?.value).toContain('принтер HP');
    expect(fields.cabinet?.quote?.text).toContain('312');
    expect(fields.cabinet?.trace[0]?.kind).toBe('found');
  });

  it('не выдумывает поля в пустом тексте', async () => {
    const step = example.steps[0];
    const empty = { ...context(), appeal: { ...appeal, originalText: 'опять ничего не работает' } };
    const patch = await step?.run(empty);
    expect(patch?.fields).toEqual({});
  });

  it('запасной путь возвращает пустые поля', async () => {
    const step = example.steps[0];
    const patch = await step?.fallback?.(context(), new Error('сбой'));
    expect(patch).toEqual({ fields: {} });
  });

  it('подписчик публикует событие модуля', async () => {
    const published: string[] = [];
    const moduleDeps = {
      ...deps(),
      bus: { publish: async (event: { type: string }) => void published.push(event.type) },
    };
    await example.subscribers[0]?.handle(
      {
        id: 'e-1',
        type: 'ticket.confirmed',
        at: '2026-11-14T10:00:00.000Z',
        actor: { kind: 'user', id: 'u-dispatcher-1' },
        ticketId: 't-1',
        payload: { assigneeId: 'u-engineer-1' },
      },
      moduleDeps,
    );
    expect(published).toEqual(['example.matched']);
  });

  it('маршрут модуля отвечает и объявляет право', async () => {
    const routes: { path: string; access: string; handler: (ctx: unknown) => Promise<unknown> }[] = [];
    const router = {
      add: () => undefined,
      get: (path: string, access: string, handler: (ctx: unknown) => Promise<unknown>) =>
        routes.push({ path, access, handler }),
      post: () => undefined,
      patch: () => undefined,
    };
    example.routes?.(router as never, deps());
    expect(routes[0]?.path).toBe('/ping');
    expect(routes[0]?.access).toBe('tickets.read');
    const result = await routes[0]?.handler({ user: { id: 'u-1' } });
    expect(result).toEqual({ ok: true, userId: 'u-1' });
  });

  it('сид проходит без ошибок', async () => {
    await expect(example.seed?.({ db: new MemoryStore(), data, clock: ports.clock })).resolves.toBeUndefined();
  });
});
