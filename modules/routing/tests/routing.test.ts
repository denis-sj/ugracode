import { describe, expect, it } from 'vitest';
import { MemoryStore, createReferenceData, type ModuleDeps, type StepContext } from '@ugra/core';
import type { AnalysisDraft, Appeal, Ticket } from '@ugra/contracts';
import type { EngineerProfile } from '../contracts';
import routing from '../server';
import { DEMO_ENGINEERS } from '../server/engineers';
import { scoreCandidates } from '../server/scoring';

const appeal: Appeal = {
  id: 'a-1',
  channel: 'chat',
  authorId: 'u-1',
  originalText: 'Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

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

function engineer(patch: Partial<EngineerProfile> & { id: string }): EngineerProfile {
  return {
    fullName: `Инженер ${patch.id}`,
    departmentId: '',
    level: 1,
    skills: [],
    buildings: [],
    onShift: true,
    openTickets: 0,
    resolvedSimilar: 0,
    ...patch,
  };
}

function scoreOf(list: { userId: string; score: number }[], userId: string): number {
  return list.find((item) => item.userId === userId)?.score ?? Number.NaN;
}

function context(draft: AnalysisDraft, data = createReferenceData()): StepContext {
  return {
    runId: 'run-1',
    appeal,
    draft,
    ports,
    data,
    progress: () => undefined,
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

function emptyDraft(): AnalysisDraft {
  return { sources: [], fields: {}, missing: [], ext: {} };
}

function memoryDeps(store: MemoryStore, data = createReferenceData()): ModuleDeps {
  return {
    bus: { publish: async () => undefined },
    ports,
    data,
    db: store,
    tickets: {
      createDraft: async () => Promise.reject(new Error('не нужен')),
    } as unknown as ModuleDeps['tickets'],
    settings: { get: async () => undefined },
    clock: ports.clock,
  };
}

function ticket(): Ticket {
  return {
    id: 't-1',
    number: 'З-20261114-0001',
    appealId: appeal.id,
    status: 'in_review',
    priority: 'medium',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
  };
}

describe('routing: оценка кандидатов', () => {
  it('ставит первым инженера с навыком, сменой и корпусом из примера заказчика', () => {
    const engineers = [
      engineer({
        id: 'u-1',
        departmentId: 'dep-it',
        skills: [{ skill: 'принтеры HP', level: 4 }],
        buildings: ['Б'],
        onShift: true,
      }),
      engineer({
        id: 'u-2',
        departmentId: 'dep-network',
        skills: [{ skill: 'сети', level: 5 }],
        buildings: ['А'],
        onShift: true,
      }),
      engineer({
        id: 'u-3',
        departmentId: 'dep-software',
        skills: [{ skill: '1С', level: 5 }],
        buildings: ['В'],
        onShift: false,
      }),
    ];

    const top = scoreCandidates({
      engineers,
      category: 'printer',
      equipment: 'принтер HP',
      building: 'Б',
      text: appeal.originalText,
    });

    expect(top).toHaveLength(3);
    expect(top[0]?.userId).toBe('u-1');
    const reasons = top[0]?.reasons.join(' | ') ?? '';
    expect(reasons).toContain('навык „принтеры HP“ — уровень 4');
    expect(reasons).toContain('на смене');
    expect(reasons).toContain('корпус Б');
    expect(reasons).toContain('подразделение «ИТ»');
  });

  it('меняет порядок, когда корпус заявки совпал с закреплением инженера', () => {
    const engineers = [
      engineer({
        id: 'u-a',
        departmentId: 'dep-it',
        skills: [{ skill: 'принтеры', level: 3 }],
        buildings: ['Б'],
      }),
      engineer({
        id: 'u-b',
        departmentId: 'dep-it',
        skills: [{ skill: 'принтеры', level: 3 }],
        buildings: ['В'],
      }),
    ];

    const withoutBuilding = scoreCandidates({ engineers, category: 'printer' });
    expect(withoutBuilding.map((item) => item.userId)).toEqual(['u-a', 'u-b']);
    expect(scoreOf(withoutBuilding, 'u-a')).toBe(scoreOf(withoutBuilding, 'u-b'));

    const withBuilding = scoreCandidates({ engineers, category: 'printer', building: 'В' });
    expect(withBuilding.map((item) => item.userId)).toEqual(['u-b', 'u-a']);
    expect(scoreOf(withBuilding, 'u-b')).toBeGreaterThan(scoreOf(withBuilding, 'u-a'));
  });

  it('снижает балл загрузкой и объясняет её числом открытых заявок', () => {
    const engineers = [
      engineer({ id: 'u-busy', departmentId: 'dep-it', openTickets: 4 }),
      engineer({ id: 'u-free', departmentId: 'dep-it', openTickets: 0 }),
    ];

    const top = scoreCandidates({ engineers, category: 'printer' });

    expect(scoreOf(top, 'u-free')).toBeGreaterThan(scoreOf(top, 'u-busy'));
    expect(top.find((item) => item.userId === 'u-busy')?.reasons).toContain('4 открытые заявки');
    expect(top.find((item) => item.userId === 'u-free')?.reasons.join(' ')).not.toContain('открыт');
  });

  it('возвращает пусто, когда инженеров нет', () => {
    expect(scoreCandidates({ engineers: [], category: 'printer' })).toEqual([]);
  });

  it('добавляет подтверждение диспетчера при малом разрыве с вторым местом', () => {
    const close = [
      engineer({ id: 'u-1', departmentId: 'dep-it' }),
      engineer({ id: 'u-2', departmentId: 'dep-it', openTickets: 1 }),
    ];

    const top = scoreCandidates({ engineers: close, category: 'printer' });

    expect(top[0]?.userId).toBe('u-1');
    expect(top[0]?.reasons).toContain('нужно подтверждение диспетчера');
  });

  it('не просит подтверждения, когда разрыв большой и лидер на смене', () => {
    const apart = [
      engineer({ id: 'u-1', departmentId: 'dep-it' }),
      engineer({ id: 'u-2', departmentId: 'dep-service', onShift: false, openTickets: 10 }),
    ];

    const top = scoreCandidates({ engineers: apart, category: 'printer' });

    expect(top[0]?.reasons).not.toContain('нужно подтверждение диспетчера');
  });
});

describe('routing: метрика оценки', () => {
  const step = routing.steps[0];

  it('даёт 1 за попадание в топ-1 и топ-3', () => {
    const draft: AnalysisDraft = {
      ...emptyDraft(),
      assignees: [{ userId: 'u-1', score: 10, reasons: [] }],
    };

    const metrics = step?.evaluate?.({ assigneeTop3: ['u-1'] }, draft) ?? [];
    const top1 = metrics.find((item) => item.key === 'assignee_top1');
    const top3 = metrics.find((item) => item.key === 'assignee_top3');

    expect(top1?.value).toBe(1);
    expect(top1?.passed).toBe(true);
    expect(top3?.value).toBe(1);
  });

  it('даёт 0, когда эталонного инженера нет среди кандидатов', () => {
    const draft: AnalysisDraft = {
      ...emptyDraft(),
      assignees: [{ userId: 'u-1', score: 10, reasons: [] }],
    };

    const metrics = step?.evaluate?.({ assigneeTop3: ['u-404'] }, draft) ?? [];

    expect(metrics.find((item) => item.key === 'assignee_top1')?.value).toBe(0);
    expect(metrics.find((item) => item.key === 'assignee_top3')?.value).toBe(0);
  });
});

describe('routing: шаг разбора', () => {
  it('пишет assignees и не падает на пустом черновике', async () => {
    const step = routing.steps[0];
    const draft = emptyDraft();

    const patch = await step?.run(context(draft));

    expect(patch?.assignees?.length).toBe(3);
    expect(patch?.assignees?.every((item) => typeof item.userId === 'string')).toBe(true);
  });

  it('берёт инженеров из data.extra.engineers и ставит их в черновик', async () => {
    const step = routing.steps[0];
    const data = createReferenceData({
      extra: {
        engineers: {
          engineers: [
            engineer({ id: 'u-1', departmentId: 'dep-it', skills: [{ skill: 'принтеры', level: 5 }] }),
            engineer({ id: 'u-2', departmentId: 'dep-it', skills: [{ skill: 'сети', level: 5 }] }),
          ],
        },
      },
    });
    const draft: AnalysisDraft = {
      ...emptyDraft(),
      fields: {
        category: {
          key: 'category',
          value: 'printer',
          confidence: 0.9,
          quote: null,
          origin: 'text',
          needsReview: false,
          trace: [],
        },
      },
    };

    const patch = await step?.run(context(draft, data));

    expect(patch?.assignees?.[0]?.userId).toBe('u-1');
  });

  it('подставляет демо-набор, когда данных инженеров нет', async () => {
    const step = routing.steps[0];
    const patch = await step?.run(context(emptyDraft(), createReferenceData({ extra: { engineers: [] } })));

    expect(DEMO_ENGINEERS.length).toBe(5);
    expect(patch?.assignees?.length).toBe(3);
  });

  it('запасной путь отдаёт пустой список, а не ошибку', async () => {
    const step = routing.steps[0];
    const patch = await step?.fallback?.(context(emptyDraft()), new Error('сбой'));

    expect(patch).toEqual({ assignees: [] });
  });
});

describe('routing: маршрут кандидатов', () => {
  function collect(deps: ModuleDeps) {
    const routes: {
      path: string;
      access: string;
      handler: (ctx: { params: Record<string, string>; user: { id: string } }) => Promise<unknown>;
    }[] = [];
    const router = {
      add: () => undefined,
      get: (path: string, access: string, handler: never) => void routes.push({ path, access, handler }),
      post: () => undefined,
      patch: () => undefined,
    };
    routing.routes?.(router as never, deps);
    return routes;
  }

  async function store(): Promise<MemoryStore> {
    const memory = new MemoryStore();
    await memory.saveAppeal(appeal);
    await memory.saveTicket(ticket());
    await memory.saveTicketFields('t-1', [
      {
        ticketId: 't-1',
        fieldKey: 'building',
        value: 'Б',
        confidence: 0.9,
        quote: null,
        origin: 'text',
        needsReview: false,
        trace: [],
        aiValue: 'Б',
      },
    ]);
    return memory;
  }

  it('пересчитывает кандидатов по заявке из базы', async () => {
    const route = collect(memoryDeps(await store())).find((item) => item.path === '/candidates/:ticketId');

    expect(route?.access).toBe('tickets.read');
    const result = (await route?.handler({ params: { ticketId: 't-1' }, user: { id: 'u-d' } })) as {
      candidates: { userId: string }[];
    };

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.userId).toBe('u-eng-1');
  });

  it('падает понятной ошибкой, когда заявки нет', async () => {
    const route = collect(memoryDeps(new MemoryStore())).find(
      (item) => item.path === '/candidates/:ticketId',
    );

    await expect(route?.handler({ params: { ticketId: 't-404' }, user: { id: 'u-d' } })).rejects.toThrow(
      /не найдена/,
    );
  });
});
