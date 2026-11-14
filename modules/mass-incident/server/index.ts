import { randomUUID } from 'node:crypto';
import type { Appeal, Ticket, TicketField } from '@ugra/contracts';
import type { ModuleDeps, PipelineStep, StepContext } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { DemoResponse, IncidentDetailResponse, IncidentsResponse } from '../contracts';
import { openMassIncident, type MassTarget } from './detect';
import { asText, systemOf } from './place';

const STEP_ID = 'mass-incident.detect';

/** Демо: корпус Б, кабинет 312 — «больной» принтер из примера заказчика. */
const DEMO_BUILDING = 'Б';
const DEMO_CABINET = '312';
const DEMO_CATEGORY = 'printer';
const DEMO_OBJECT = 'принтер';
const DEMO_TEXTS = [
  'Принтер в кабинете 312 не печатает, мигает красный индикатор',
  'МФУ в 312 замяло бумагу, очередь документов стоит',
  'Печать из 1С не уходит на принтер в 312',
  'Принтер в кабинете 312 печатает пустые листы',
  'Не можем отправить документ на печать: принтер 312 не отвечает',
  'МФУ в 312 шумит и не захватывает бумагу',
];

/** Место и система текущего обращения из черновика: то, что уже извлёк разбор. */
function targetFromDraft(ctx: StepContext): MassTarget {
  const value = (key: string): string | null => asText(ctx.draft.fields[key]?.value);
  const category = value('category');
  return {
    appealId: ctx.appeal.id,
    category,
    building: value('building'),
    cabinet: value('cabinet'),
    system: systemOf(category, value('object')),
  };
}

/**
 * Шаг `mass-incident.detect`: считает похожие обращения за окно и при пороге создаёт
 * инцидент. Без эмбеддингов: категория + корпус, система или разные категории в одном месте.
 */
const detectStep: PipelineStep = {
  id: STEP_ID,
  title: 'Ищем массовый сбой',
  stage: 'assess',
  order: 150,
  reads: ['fields', 'incident'],
  writes: ['incident'],
  async run(ctx) {
    // Уже в инциденте — второй не создаём: заявка прикреплена к существующему.
    if (ctx.db === undefined || ctx.draft.incident !== undefined) return {};

    const result = await openMassIncident(
      { db: ctx.db, data: ctx.data, ports: ctx.ports, bus: ctx.bus },
      targetFromDraft(ctx),
    );
    if (result === null) return {};

    ctx.progress({
      stepId: STEP_ID,
      status: 'progress',
      message: `Похожих обращений: ${result.size} — инцидент ${result.incident.number}`,
    });
    return {
      incident: {
        incidentId: result.incident.id,
        size: result.size,
        reason: result.reason,
      },
    };
  },
  async fallback() {
    // Массовость — подсказка диспетчеру: сбой подсчёта не должен останавливать разбор.
    return {};
  },
};

function demoFields(ticketId: string, text: string): TicketField[] {
  const values: readonly [string, string][] = [
    ['building', DEMO_BUILDING],
    ['cabinet', DEMO_CABINET],
    ['category', DEMO_CATEGORY],
    ['object', DEMO_OBJECT],
    ['symptoms', text],
  ];
  return values.map(([fieldKey, value]) => ({
    ticketId,
    fieldKey,
    value,
    confidence: 0.95,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: value,
  }));
}

/**
 * Демо-всплеск: N одинаковых обращений «принтер, корпус Б, каб. 312» с текущим временем.
 * Последний шаг — та же склейка, что и в разборе, поэтому инцидент создаётся сразу.
 */
async function seedDemo(deps: ModuleDeps): Promise<{ created: number; incidentId?: string }> {
  const createdAt = deps.clock.now().toISOString();
  const tickets: Ticket[] = [];
  for (const text of DEMO_TEXTS) {
    const appeal: Appeal = {
      id: randomUUID(),
      channel: 'chat',
      authorId: 'u-demo-312',
      originalText: text,
      attachments: [],
      createdAt,
    };
    await deps.db.saveAppeal(appeal);
    const draft = await deps.tickets.createDraft(appeal);
    await deps.db.saveTicketFields(draft.id, demoFields(draft.id, text));
    const updated = await deps.db.updateTicket(draft.id, {
      status: 'in_review',
      category: DEMO_CATEGORY,
      updatedAt: createdAt,
    });
    tickets.push(updated ?? draft);
  }

  const first = tickets[0];
  if (first === undefined) return { created: 0 };

  const result = await openMassIncident(
    { db: deps.db, data: deps.data, ports: deps.ports, bus: deps.bus },
    {
      appealId: first.appealId,
      category: DEMO_CATEGORY,
      building: DEMO_BUILDING,
      cabinet: DEMO_CABINET,
      system: systemOf(DEMO_CATEGORY, DEMO_OBJECT),
    },
  );
  return result === null
    ? { created: tickets.length }
    : { created: tickets.length, incidentId: result.incident.id };
}

export default defineModule({
  id: 'mass-incident',
  title: 'Массовость: склейка обращений в инцидент',
  enabledByDefault: true,
  steps: [detectStep],
  events: [
    {
      type: 'mass-incident.opened',
      description: 'Порог похожих обращений пройден: создан инцидент, заявки привязаны',
    },
  ],
  routes(router, deps) {
    router.post('/demo', 'admin', async () => seedDemo(deps), { response: DemoResponse });

    router.get(
      '/incidents',
      'tickets.read',
      async () => {
        const [incidents, tickets] = await Promise.all([
          deps.db.listIncidents({ limit: 200 }),
          deps.db.listTickets({ limit: 1000 }),
        ]);
        return {
          incidents: incidents.map((incident) => ({
            ...incident,
            ticketCount: tickets.filter((ticket) => ticket.incidentId === incident.id).length,
          })),
        };
      },
      { response: IncidentsResponse },
    );

    router.get(
      '/incidents/:id',
      'tickets.read',
      async ({ params }) => {
        const id = params.id;
        if (id === undefined || id === '') throw new Error('Не указан инцидент');
        const incident = await deps.db.getIncident(id);
        if (incident === null) throw new Error(`Инцидент ${id} не найден`);
        const tickets = (await deps.db.listTickets({ limit: 1000 }))
          .filter((ticket) => ticket.incidentId === incident.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        return { incident, tickets };
      },
      { response: IncidentDetailResponse },
    );
  },
  async seed() {
    // Своих данных нет: инциденты создаются шагом и демо-маршрутом.
  },
});
