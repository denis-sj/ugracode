import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentContext, KnowledgeArticle, ModuleDeps } from '@ugra/core';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData, runAgent } from '@ugra/core';
import type { LlmPort } from '@ugra/core';
import type { LlmChatResponse, Ticket, ToolCall } from '@ugra/contracts';
import { makePorts, makeUser } from '@ugra/testkit';
import knowledge from '../server';
import { checkEngineerAnswer, engineerAssistant } from '../server/assistant';
import { AskQuestionInput } from '../server/schemas';
import type { KnowledgeAgentContext } from '../server/sources';
import { kbGetArticleTool, kbSearchTool, ticketsFindSimilarTool } from '../server/tools';

/** Статьи берём из `data/kb/*.json` — тех же файлов, что загружает сид базы. */
const KB_DIR = fileURLToPath(new URL('../../../data/kb/', import.meta.url));

interface KbFile {
  articles: KnowledgeArticle[];
}

function loadArticles(): KnowledgeArticle[] {
  return readdirSync(KB_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const parsed = JSON.parse(readFileSync(`${KB_DIR}${name}`, 'utf8')) as KbFile;
      return parsed.articles;
    });
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const article of loadArticles()) await store.saveKnowledgeArticle(article);
  return store;
}

function context(store: MemoryStore): AgentContext {
  return {
    user: makeUser({ id: 'u-engineer-2', role: 'engineer', position: 'Инженер' }),
    ports: makePorts(),
    data: createReferenceData(),
    db: store,
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

describe('модуль knowledge: инструменты', () => {
  it('объявляет три инструмента в модуле', () => {
    expect(knowledge.tools.map((tool) => tool.name).sort()).toEqual([
      'kb_get_article',
      'kb_search',
      'tickets_find_similar',
    ]);
    expect(knowledge.enabledByDefault).toBe(true);
  });

  it('kb_search находит статью про принтер и красный индикатор', async () => {
    const store = await seededStore();
    const result = await kbSearchTool.execute(
      { query: 'принтер не печатает, мигает красный индикатор' },
      context(store),
    );
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.articles[0]?.id).toBe('kb-print-red-indicator');
    expect(result.articles[0]?.score).toBeGreaterThan(0);
  });

  it('kb_search находит статью про замятие бумаги', async () => {
    const store = await seededStore();
    const result = await kbSearchTool.execute({ query: 'замятие бумаги' }, context(store));
    expect(result.articles[0]?.id).toBe('kb-print-jam');
    expect(result.articles[0]?.symptoms.join(' ')).toContain('замятие');
  });

  it('kb_search уважает категорию и лимит', async () => {
    const store = await seededStore();
    const printer = await kbSearchTool.execute({ query: 'принтер', category: 'printer', limit: 2 }, context(store));
    expect(printer.articles.length).toBeLessThanOrEqual(2);
    expect(printer.articles.every((article) => article.category === 'printer')).toBe(true);

    const network = await kbSearchTool.execute({ query: 'принтер', category: 'network' }, context(store));
    expect(network.articles).toEqual([]);
  });

  it('kb_get_article возвращает шаги статьи', async () => {
    const store = await seededStore();
    const result = await kbGetArticleTool.execute({ id: 'kb-print-red-indicator' }, context(store));
    expect(result.article?.title).toContain('красный индикатор');
    expect(result.article?.steps.length).toBeGreaterThan(0);
    expect(result.article?.solution).toContain('картридж');
  });

  it('kb_get_article на неизвестный id отдаёт null', async () => {
    const store = await seededStore();
    const result = await kbGetArticleTool.execute({ id: 'kb-нет-такой' }, context(store));
    expect(result.article).toBeNull();
  });

  it('tickets_find_similar на пустой базе отдаёт пустой список', async () => {
    const result = await ticketsFindSimilarTool.execute(
      { text: 'принтер не печатает', category: 'printer', building: 'Б' },
      context(new MemoryStore()),
    );
    expect(result.tickets).toEqual([]);
  });
});

function deps(store: MemoryStore, llm?: LlmPort): ModuleDeps {
  const clock = { now: () => new Date('2026-11-14T10:00:00.000Z') };
  const bus = new KernelEventBus(store);
  const ports = makePorts();
  return {
    bus,
    ports: llm ? { ...ports, llm } : ports,
    data: createReferenceData(),
    db: store,
    tickets: new TicketService({ store, bus, clock }),
    settings: {
      async get<T = unknown>(): Promise<T | undefined> {
        return undefined;
      },
    },
    clock,
  };
}

function ticket(id: string, number: string): Ticket {
  return {
    id,
    number,
    appealId: `appeal-${id}`,
    status: 'in_progress',
    priority: 'medium',
    category: 'printer',
    departmentId: null,
    assigneeId: 'u-engineer-2',
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    resolution: null,
    resolvedAt: null,
    createdAt: '2026-11-14T09:00:00.000Z',
    updatedAt: '2026-11-14T09:30:00.000Z',
  };
}

async function ticketStore(): Promise<MemoryStore> {
  const store = await seededStore();
  await store.saveTicket(ticket('t-1', '1042'));
  await store.saveTicket(ticket('t-2', '1043'));
  return store;
}

function routesOf(store: MemoryStore, llm?: LlmPort) {
  return collectRoutes([knowledge], deps(store, llm))[0]?.routes ?? [];
}

function route(store: MemoryStore, method: 'GET' | 'POST', path: string, llm?: LlmPort) {
  const found = routesOf(store, llm).find((item) => item.method === method && item.path === path);
  if (!found) throw new Error(`маршрут ${method} ${path} не найден`);
  return found;
}

describe('модуль knowledge: маршрут поиска', () => {
  it('отдаёт статьи и похожие заявки по строке запроса', async () => {
    const store = await seededStore();
    const search = route(store, 'GET', '/search');
    expect(search.access).toBe('tickets.read');

    const result = (await search.handler({
      body: undefined,
      params: {},
      query: { q: 'принтер мигает красный индикатор', category: 'printer' },
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { articles: KnowledgeArticle[]; tickets: unknown[] };

    expect(result.articles[0]?.id).toBe('kb-print-red-indicator');
    expect(result.tickets).toEqual([]);
  });

  it('на пустой запрос отдаёт пустые списки', async () => {
    const search = route(new MemoryStore(), 'GET', '/search');
    const result = await search.handler({
      body: undefined,
      params: {},
      query: { q: '   ' },
      user: makeUser({ role: 'engineer' }),
      deps: deps(new MemoryStore()),
    });
    expect(result).toEqual({ articles: [], tickets: [] });
  });

  it('отдаёт статью по id для кнопки «Открыть статью»', async () => {
    const store = await seededStore();
    const articleRoute = route(store, 'GET', '/articles/:id');
    expect(articleRoute.access).toBe('tickets.read');

    const found = (await articleRoute.handler({
      body: undefined,
      params: { id: 'kb-print-jam' },
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { article: KnowledgeArticle | null };
    expect(found.article?.title).toContain('Замятие');

    const missing = (await articleRoute.handler({
      body: undefined,
      params: { id: 'kb-нет-такой' },
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { article: KnowledgeArticle | null };
    expect(missing.article).toBeNull();
  });
});

describe('модуль knowledge: шаги статьи у заявки', () => {
  it('ставит галочку, повторяет без изменений и снимает её', async () => {
    const store = new MemoryStore();
    const first = await store.toggleArticleStep('t-1', 'kb-print-jam', 0, true);
    expect(first).toMatchObject({ ticketId: 't-1', articleId: 'kb-print-jam', stepIndex: 0, done: true });

    const again = await store.toggleArticleStep('t-1', 'kb-print-jam', 0, true);
    expect(again.done).toBe(true);
    expect(again.updatedAt).toBe(first.updatedAt);

    const listed = await store.listArticleSteps('t-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.done).toBe(true);

    const off = await store.toggleArticleStep('t-1', 'kb-print-jam', 0, false);
    expect(off.done).toBe(false);
    expect((await store.listArticleSteps('t-1'))[0]?.done).toBe(false);
  });

  it('не смешивает отметки разных заявок и статей', async () => {
    const store = new MemoryStore();
    await store.toggleArticleStep('t-1', 'kb-print-jam', 0, true);
    expect(await store.listArticleSteps('t-2')).toEqual([]);
    expect(await store.listArticleSteps('t-1')).toHaveLength(1);

    await store.toggleArticleStep('t-1', 'kb-print-jam', 1, true);
    await store.toggleArticleStep('t-1', 'kb-print-red-indicator', 0, true);
    const listed = await store.listArticleSteps('t-1');
    expect(listed.map((step) => `${step.articleId}:${step.stepIndex}`)).toEqual([
      'kb-print-jam:0',
      'kb-print-jam:1',
      'kb-print-red-indicator:0',
    ]);
  });

  it('GET отдаёт отметки заявки, POST сохраняет галочку', async () => {
    const store = await ticketStore();
    const getRoute = route(store, 'GET', '/tickets/:ticketId/steps');
    const postRoute = route(store, 'POST', '/tickets/:ticketId/steps');
    expect(getRoute.access).toBe('tickets.read');
    expect(postRoute.access).toBe('tickets.transition');

    const saved = (await postRoute.handler({
      body: { articleId: 'kb-print-red-indicator', stepIndex: 1, done: true },
      params: { ticketId: 't-1' },
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { step: { done: boolean; stepIndex: number } };
    expect(saved.step.done).toBe(true);
    expect(saved.step.stepIndex).toBe(1);

    const listed = (await getRoute.handler({
      body: undefined,
      params: { ticketId: 't-1' },
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { ticketId: string; steps: { articleId: string; done: boolean }[] };
    expect(listed.ticketId).toBe('t-1');
    expect(listed.steps).toEqual([
      expect.objectContaining({ articleId: 'kb-print-red-indicator', done: true }),
    ]);

    // Чужая заявка не видит отметок: состояние живёт у ticket_id.
    const other = (await getRoute.handler({
      body: undefined,
      params: { ticketId: 't-2' },
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store),
    })) as { steps: unknown[] };
    expect(other.steps).toEqual([]);
  });

  it('POST отклоняет неизвестную заявку, статью и шаг вне статьи', async () => {
    const store = await ticketStore();
    const postRoute = route(store, 'POST', '/tickets/:ticketId/steps');
    const call = (params: Record<string, string>, body: unknown) =>
      postRoute.handler({
        body,
        params,
        query: {},
        user: makeUser({ role: 'engineer' }),
        deps: deps(store),
      });

    await expect(
      call({ ticketId: 't-нет' }, { articleId: 'kb-print-jam', stepIndex: 0, done: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      call({ ticketId: 't-1' }, { articleId: 'kb-нет', stepIndex: 0, done: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      call({ ticketId: 't-1' }, { articleId: 'kb-print-jam', stepIndex: 99, done: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      call({}, { articleId: 'kb-print-jam', stepIndex: 0, done: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // Валидацию тела делает сервер по схеме маршрута.
    expect(postRoute.body?.safeParse({ articleId: 'kb-print-jam', stepIndex: -1, done: true }).success).toBe(
      false,
    );
  });

  it('GET на неизвестную заявку отвечает 404', async () => {
    const store = await ticketStore();
    const getRoute = route(store, 'GET', '/tickets/:ticketId/steps');
    await expect(
      getRoute.handler({
        body: undefined,
        params: { ticketId: 't-нет' },
        query: {},
        user: makeUser({ role: 'engineer' }),
        deps: deps(store),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

/** Заглушка модели: заранее записанная последовательность ходов. */
class ScriptedLlm implements LlmPort {
  readonly requests: LlmChatResponse[] = [];
  private readonly turns: LlmChatResponse[];

  constructor(turns: LlmChatResponse[]) {
    this.turns = [...turns];
  }

  async structured(): Promise<never> {
    throw new Error('structured в агенте не используется');
  }

  async chat(): Promise<LlmChatResponse> {
    const turn = this.turns.shift();
    if (turn) {
      this.requests.push(turn);
      return turn;
    }
    return {
      message: { role: 'assistant', content: 'сценарий исчерпан', toolCalls: [] },
      finishReason: 'stop',
      model: 'test',
    };
  }
}

function call(name: string, args: unknown, id = `call_${name}`): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function toolTurn(...calls: ToolCall[]): LlmChatResponse {
  return {
    message: { role: 'assistant', content: null, toolCalls: calls },
    finishReason: 'tool_calls',
    model: 'test',
  };
}

function submitTurn(value: unknown): LlmChatResponse {
  return toolTurn(call('submit', value, 'call_submit'));
}

function agentContext(store: MemoryStore): KnowledgeAgentContext {
  return {
    ...context(store),
    user: makeUser({ id: 'u-engineer-2', role: 'engineer', position: 'Инженер' }),
    knowledgeSources: new Set<string>(),
  };
}

function agentTools() {
  return new Map(
    [kbSearchTool, kbGetArticleTool, ticketsFindSimilarTool].map((tool) => [tool.name, tool]),
  );
}

describe('модуль knowledge: агент engineer-assistant', () => {
  it('объявляет агента с тремя инструментами базы знаний', () => {
    expect(knowledge.agents.map((agent) => agent.id)).toEqual(['engineer-assistant']);
    expect(engineerAssistant.tools).toEqual(['kb_search', 'kb_get_article', 'tickets_find_similar']);
  });

  it('сдаёт ответ со ссылками на статьи из результата kb_search', async () => {
    const store = await seededStore();
    const ctx = agentContext(store);
    const llm = new ScriptedLlm([
      toolTurn(call('kb_search', { query: 'принтер не печатает красный индикатор' })),
      submitTurn({
        answer: 'Замените картридж и проверьте бумагу.',
        sources: [{ id: 'kb-print-red-indicator', title: 'Принтер HP не печатает, мигает красный индикатор' }],
        steps: ['Проверить бумагу', 'Заменить картридж'],
      }),
    ]);

    const run = await runAgent(
      engineerAssistant,
      { text: 'принтер мигает красным, что делать?', context: ctx },
      { llm, tools: agentTools(), runId: 'ask-ok' },
    );

    expect(run.status).toBe('ok');
    expect(run.result?.sources[0]?.id).toBe('kb-print-red-indicator');
    expect(run.result?.steps).toHaveLength(2);
    expect(run.steps.map((step) => step.tool)).toEqual(['kb_search', 'submit']);
    expect(run.steps[0]?.blocked).toBe(false);
  });

  it('отклоняет выдуманный источник: id не из результатов инструментов', async () => {
    const store = await seededStore();
    const ctx = agentContext(store);
    const llm = new ScriptedLlm([
      toolTurn(call('kb_search', { query: 'принтер не печатает красный индикатор' })),
      submitTurn({
        answer: 'Выдуманный ответ',
        sources: [{ id: 'kb-выдуманная', title: 'Статья, которой не было в поиске' }],
      }),
    ]);

    const run = await runAgent(
      engineerAssistant,
      { text: 'принтер мигает красным', context: ctx },
      { llm, tools: agentTools(), runId: 'ask-fake' },
    );

    expect(run.status).toBe('failed');
    const rejected = run.steps.find((step) => step.tool === 'submit');
    expect(rejected?.error).toContain('нет в результатах инструментов');
    expect(run.result).toBeUndefined();
  });

  it('check сам требует хотя бы одну ссылку', () => {
    const ctx = agentContext(new MemoryStore());
    expect(checkEngineerAnswer({ answer: 'ответ', sources: [] }, ctx)).toEqual([
      'нет ссылок на источники: ответ без статей не принимается',
    ]);
  });

  it('возвращает ошибку, если модель недоступна', async () => {
    const store = await seededStore();
    const llm: LlmPort = {
      async structured(): Promise<never> {
        throw new Error('не нужен');
      },
      async chat(): Promise<never> {
        throw new Error('сеть недоступна');
      },
    };
    const run = await runAgent(
      engineerAssistant,
      { text: 'вопрос', context: agentContext(store) },
      { llm, tools: agentTools(), runId: 'ask-down' },
    );
    expect(run.status).toBe('failed');
    expect(run.error).toContain('модель недоступна');
  });
});

describe('модуль knowledge: вопрос базе знаний (маршрут /ask)', () => {
  it('отвечает агентом со ссылками на источники', async () => {
    const store = await seededStore();
    const llm = new ScriptedLlm([
      toolTurn(call('kb_search', { query: 'принтер не печатает красный индикатор' })),
      submitTurn({
        answer: 'Проверьте картридж.',
        sources: [{ id: 'kb-print-red-indicator', title: 'Принтер HP не печатает, мигает красный индикатор' }],
      }),
    ]);
    const askRoute = route(store, 'POST', '/ask', llm);
    expect(askRoute.access).toBe('tickets.read');

    const result = (await askRoute.handler({
      body: { question: 'принтер мигает красным индикатором, что проверить?' },
      params: {},
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store, llm),
    })) as { answer: string; sources: { id: string }[]; mode: string };

    expect(result.mode).toBe('agent');
    expect(result.answer).toContain('картридж');
    expect(result.sources[0]?.id).toBe('kb-print-red-indicator');
  });

  it('без источников от модели отдаёт шаблон по найденным статьям', async () => {
    const store = await seededStore();
    const llm = new ScriptedLlm([
      toolTurn(call('kb_search', { query: 'принтер не печатает красный индикатор' })),
      submitTurn({ answer: 'Просто попробуйте перезагрузить.', sources: [] }),
    ]);
    const askRoute = route(store, 'POST', '/ask', llm);

    const result = (await askRoute.handler({
      body: { question: 'принтер не печатает, мигает красный индикатор' },
      params: {},
      query: {},
      user: makeUser({ role: 'engineer' }),
      deps: deps(store, llm),
    })) as { mode: string; answer: string; sources: { id: string; title: string }[] };

    expect(result.mode).toBe('template');
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]?.id).toBe('kb-print-red-indicator');
    expect(result.answer).toContain('По статье');
  });

  it('отвечает 422, когда модель недоступна и статей нет', async () => {
    const store = new MemoryStore();
    const llm: LlmPort = {
      async structured(): Promise<never> {
        throw new Error('не нужен');
      },
      async chat(): Promise<never> {
        throw new Error('нет ключа');
      },
    };
    const askRoute = route(store, 'POST', '/ask', llm);

    await expect(
      askRoute.handler({
        body: { question: 'принтер не печатает' },
        params: {},
        query: {},
        user: makeUser({ role: 'engineer' }),
        deps: deps(store, llm),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('валидирует вопрос схемой маршрута', () => {
    const askRoute = route(new MemoryStore(), 'POST', '/ask');
    expect(askRoute.body).toBe(AskQuestionInput);
    expect(AskQuestionInput.safeParse({ question: 'да' }).success).toBe(false);
    expect(AskQuestionInput.safeParse({ question: '   ' }).success).toBe(false);
    expect(AskQuestionInput.safeParse({ question: 'принтер не печатает' }).success).toBe(true);
  });
});
