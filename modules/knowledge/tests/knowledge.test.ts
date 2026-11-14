import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentContext, KnowledgeArticle, ModuleDeps } from '@ugra/core';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import knowledge from '../server';
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

describe('модуль knowledge: маршрут поиска', () => {
  function deps(store: MemoryStore): ModuleDeps {
    const clock = { now: () => new Date('2026-11-14T10:00:00.000Z') };
    const bus = new KernelEventBus(store);
    return {
      bus,
      ports: makePorts(),
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

  it('отдаёт статьи и похожие заявки по строке запроса', async () => {
    const store = await seededStore();
    const routes = collectRoutes([knowledge], deps(store));
    const route = routes[0]?.routes.find((item) => item.path === '/search');
    expect(route?.access).toBe('tickets.read');

    const result = (await route?.handler({
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
    const routes = collectRoutes([knowledge], deps(new MemoryStore()));
    const route = routes[0]?.routes.find((item) => item.path === '/search');
    const result = await route?.handler({
      body: undefined,
      params: {},
      query: { q: '   ' },
      user: makeUser({ role: 'engineer' }),
      deps: deps(new MemoryStore()),
    });
    expect(result).toEqual({ articles: [], tickets: [] });
  });
});
