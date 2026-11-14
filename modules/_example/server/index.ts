import { z } from 'zod';
import type { FieldValue } from '@ugra/contracts';
import { defineModule } from '@ugra/core';
import type { AgentProfile, ToolDef } from '@ugra/core';

interface ExampleExtras {
  matched: string[];
}

function field(
  key: string,
  value: string,
  quote: string,
  confidence: number,
  at: string,
): FieldValue {
  return {
    key,
    value,
    confidence,
    quote: { sourceId: 'appeal', text: quote },
    origin: 'text',
    needsReview: false,
    trace: [{ kind: 'found', step: 'example.extract', at, quote }],
  };
}

/** Образец шага: простые правила вместо модели. Демонстрирует точку расширения `steps`. */
const extractStep = {
  id: 'example.extract',
  title: 'Разбираем текст правилами',
  stage: 'extract' as const,
  order: 100,
  reads: ['sources' as const],
  writes: ['fields' as const],
  async run(ctx: {
    appeal: { originalText: string };
    data: { settings: Record<string, unknown> };
    progress(p: { stepId: string; status: 'started' | 'progress' | 'completed' | 'failed'; fields?: string[] }): void;
  }) {
    const text = ctx.appeal.originalText;
    const at = new Date().toISOString();
    const fields: Record<string, FieldValue> = {};
    const building = /(?:корпус|корп\.?)\s*([А-ЯЁA-Z])/i.exec(text);
    const cabinet = /каб(?:инет)?\.?\s*(\d{2,4})/i.exec(text);
    const equipment = /(принтер\s+[A-ZА-ЯЁ][\w-]*)/i.exec(text);
    if (building?.[1]) {
      fields.building = field('building', building[1].toUpperCase(), building[0], 0.9, at);
      ctx.progress({ stepId: 'example.extract', status: 'progress', fields: ['building'] });
    }
    if (cabinet?.[1]) {
      fields.cabinet = field('cabinet', cabinet[1], cabinet[0], 0.9, at);
      ctx.progress({ stepId: 'example.extract', status: 'progress', fields: ['cabinet'] });
    }
    if (equipment?.[1]) {
      fields.equipment = field('equipment', equipment[1].trim(), equipment[1], 0.7, at);
      ctx.progress({ stepId: 'example.extract', status: 'progress', fields: ['equipment'] });
    }
    const category = /(принтер|мфу)/i.exec(text)
      ? { value: 'printer', quote: /(принтер|мфу)[^,.;]*/i.exec(text)?.[0] ?? 'принтер' }
      : /(свитч|сеть|интернет|вай-?фай|wi-?fi)/i.exec(text)
        ? { value: 'network', quote: /(свитч|сеть|интернет|вай-?фай|wi-?fi)[^,.;]*/i.exec(text)?.[0] ?? 'сеть' }
        : /(компьютер|пк|ноутбук)/i.exec(text)
          ? { value: 'pc', quote: /(компьютер|пк|ноутбук)[^,.;]*/i.exec(text)?.[0] ?? 'компьютер' }
          : /(1с|программ)/i.exec(text)
            ? { value: 'software', quote: /(1с|программ)[^,.;]*/i.exec(text)?.[0] ?? 'программа' }
            : null;
    if (category) {
      fields.category = field('category', category.value, category.quote, 0.85, at);
      ctx.progress({ stepId: 'example.extract', status: 'progress', fields: ['category'] });
    }
    return { fields };
  },
  async fallback() {
    return { fields: {} };
  },
};

/** Образец инструмента агента: принимает текст, возвращает эхо. */
const EchoInput = z.object({ text: z.string().min(1) });

const echoTool: ToolDef<z.infer<typeof EchoInput>, { echo: string }> = {
  name: 'example_echo',
  description: 'Повторяет переданный текст. Показывает, как агент вызывает инструмент модуля.',
  input: EchoInput,
  capability: 'tickets.read',
  async execute(args) {
    return { echo: args.text };
  },
  summarize(result) {
    return `эхо: ${result.echo.slice(0, 40)}`;
  },
};

/** Образец агента: один инструмент, результат — `{ answer }`. */
const exampleAgent: AgentProfile<{ answer: string }> = {
  id: 'example',
  promptId: 'modules/_example/prompts/example.v1.md',
  tools: ['example_echo'],
  submit: z.object({ answer: z.string().min(1) }),
  maxSteps: 4,
  async state() {
    return { module: 'example', hint: 'Сдай ответ через submit' };
  },
};

export default defineModule({
  id: 'example',
  title: 'Пример модуля',
  enabledByDefault: true,
  fields: [],
  steps: [extractStep],
  tools: [echoTool],
  agents: [exampleAgent],
  events: [{ type: 'example.matched', description: 'Модуль-образец отреагировал на подтверждение заявки' }],
  subscribers: [
    {
      on: 'ticket.confirmed',
      async handle(event, deps) {
        const payload = event.payload as { assigneeId?: string } | undefined;
        await deps.bus.publish({
          type: 'example.matched',
          actor: { kind: 'system' },
          ticketId: event.ticketId,
          payload: { assigneeId: payload?.assigneeId ?? null },
        });
      },
    },
  ],
  routes(router) {
    router.get('/ping', 'tickets.read', async ({ user }) => ({ ok: true, userId: user.id }));
  },
  async seed() {
    // У модуля-образца нет своих данных.
  },
});

export type { ExampleExtras };
