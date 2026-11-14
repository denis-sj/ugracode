import { describe, expect, it } from 'vitest';
import type { Ticket, TicketField } from '@ugra/contracts';
import type { KnowledgeArticle } from '../src';
import { MemoryStore } from '../src';

/** Статьи для теста: заголовки и симптомы пересекаются с запросами по-разному. */
const articles: KnowledgeArticle[] = [
  {
    id: 'kb-print-red-indicator',
    title: 'Принтер HP не печатает, мигает красный индикатор',
    symptoms: ['мигает красный индикатор', 'принтер не печатает'],
    steps: ['Проверить бумагу', 'Заменить картридж'],
    solution: 'Заменить картридж или устранить замятие.',
    category: 'printer',
  },
  {
    id: 'kb-print-jam',
    title: 'Замятие бумаги в принтере',
    symptoms: ['замятие бумаги', 'лист застрял внутри'],
    steps: ['Выключить устройство', 'Вытянуть лист'],
    solution: 'Удалить замятую бумагу и проверить ролики.',
    category: 'printer',
  },
  {
    id: 'kb-network-vpn',
    title: 'Не подключается VPN',
    symptoms: ['ошибка авторизации', 'нет доступа к сети'],
    steps: ['Проверить пароль', 'Перезапустить клиент'],
    solution: 'Сбросить пароль VPN.',
    category: 'network',
  },
];

function store(seed: readonly KnowledgeArticle[] = articles): MemoryStore {
  const memory = new MemoryStore();
  for (const article of seed) {
    void memory.saveKnowledgeArticle(article);
  }
  return memory;
}

function ticket(id: string, number: string, category: string | null): Ticket {
  return {
    id,
    number,
    appealId: `appeal-${id}`,
    status: 'closed',
    priority: null,
    category,
    departmentId: null,
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

function field(ticketId: string, fieldKey: string, value: string): TicketField {
  return {
    ticketId,
    fieldKey,
    value,
    confidence: 0.9,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: null,
  };
}

describe('MemoryStore: база знаний', () => {
  it('находит статью по слову из симптомов', async () => {
    const memory = store();
    const found = await memory.searchKnowledge({ text: 'замятие бумаги' });
    expect(found[0]?.id).toBe('kb-print-jam');
    expect(found[0]?.score).toBeGreaterThan(0);
    expect(found[0]?.steps).toContain('Вытянуть лист');
  });

  it('сортирует статьи по числу совпавших слов', async () => {
    const memory = store();
    const found = await memory.searchKnowledge({ text: 'принтер красный индикатор не печатает' });
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]?.id).toBe('kb-print-red-indicator');
    const scores = found.map((article) => article.score ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('фильтрует по категории', async () => {
    const memory = store();
    const found = await memory.searchKnowledge({ text: 'принтер', category: 'network' });
    expect(found).toEqual([]);
    const printer = await memory.searchKnowledge({ text: 'принтер', category: 'printer' });
    expect(printer.every((article) => article.category === 'printer')).toBe(true);
    expect(printer.length).toBeGreaterThan(0);
  });

  it('на пустой запрос ничего не возвращает', async () => {
    const memory = store();
    expect(await memory.searchKnowledge({ text: '   ' })).toEqual([]);
    expect(await memory.searchKnowledge({ text: 'и в на' })).toEqual([]);
  });

  it('соблюдает лимит и отдаёт статью по id', async () => {
    const memory = store();
    const found = await memory.searchKnowledge({ text: 'принтер бумага картридж', limit: 1 });
    expect(found).toHaveLength(1);
    const article = await memory.getKnowledgeArticle('kb-print-jam');
    expect(article?.title).toContain('Замятие');
    expect(await memory.getKnowledgeArticle('нет-такой')).toBeNull();
  });
});

describe('MemoryStore: похожие заявки', () => {
  it('находит заявки по категории и корпусу', async () => {
    const memory = store();
    await memory.saveTicket(ticket('t-1', '1042', 'printer'));
    await memory.saveTicket(ticket('t-2', '1043', 'network'));
    await memory.saveTicketFields('t-1', [
      field('t-1', 'building', 'Б'),
      field('t-1', 'symptoms', 'принтер не печатает, мигает красный индикатор'),
    ]);
    await memory.saveTicketFields('t-2', [field('t-2', 'building', 'А')]);

    const byCategory = await memory.findSimilarTickets({ category: 'printer' });
    expect(byCategory.map((item) => item.number)).toEqual(['1042']);
    expect(byCategory[0]?.title).toContain('принтер не печатает');
    expect(byCategory[0]?.status).toBe('closed');

    const byBuilding = await memory.findSimilarTickets({ building: 'Б' });
    expect(byBuilding.map((item) => item.number)).toEqual(['1042']);

    const byWords = await memory.findSimilarTickets({ text: 'красный индикатор' });
    expect(byWords[0]?.ticketId).toBe('t-1');
    expect(byWords[0]?.score).toBeGreaterThan(0);
  });

  it('без слов и фильтров ничего не отдаёт', async () => {
    const memory = store();
    await memory.saveTicket(ticket('t-1', '1042', 'printer'));
    expect(await memory.findSimilarTickets({})).toEqual([]);
  });

  it('на пустой базе возвращает пустой список', async () => {
    const memory = store();
    expect(await memory.findSimilarTickets({ category: 'printer', building: 'Б' })).toEqual([]);
  });
});
