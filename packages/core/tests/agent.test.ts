import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type {
  LlmChatRequest,
  LlmChatResponse,
  Role,
  ToolCall,
} from '@ugra/contracts';
import type { LlmPort, LlmRequest, LlmResult } from '../src/ports';
import { KernelEventBus, MemoryStore, buildRegistries, createReferenceData, defineModule } from '../src';
import type { AgentContext, AgentDeps, AgentProfile, ToolDef } from '../src';
import { assembleSystemPrompt, runAgent } from '../src/agent';
import { coreTools } from '../src/tools';

/** Заглушка модели для тестов ядра: сценарий лежит в самом тесте. */
class ScriptedLlm implements LlmPort {
  readonly requests: LlmChatRequest[] = [];
  private readonly turns: LlmChatResponse[];

  constructor(turns: LlmChatResponse[]) {
    this.turns = [...turns];
  }

  async structured<T>(_req: LlmRequest<T>): Promise<LlmResult<T>> {
    throw new Error('structured в агенте не используется');
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    this.requests.push({ ...req, messages: [...req.messages] });
    const turn = this.turns.shift();
    if (turn) return turn;
    return {
      message: { role: 'assistant', content: 'сценарий исчерпан', toolCalls: [] },
      finishReason: 'stop',
      model: 'test',
    };
  }
}

const EchoInput = z.object({ text: z.string().min(1) });

const echoTool: ToolDef<z.infer<typeof EchoInput>, { echo: string }> = {
  name: 'example_echo',
  description: 'Повторяет переданный текст',
  input: EchoInput,
  capability: 'tickets.read',
  async execute(args) {
    return { echo: args.text };
  },
  summarize(result) {
    return `эхо: ${result.echo}`;
  },
};

const adminTool: ToolDef<{ secret: string }, { ok: boolean }> = {
  name: 'admin_only',
  description: 'Доступен только администратору',
  input: z.object({ secret: z.string() }),
  capability: 'admin',
  async execute() {
    return { ok: true };
  },
};

const AnswerSchema = z.object({ answer: z.string().min(1) });

function makeLlm(turns: LlmChatResponse[]): ScriptedLlm {
  return new ScriptedLlm(turns);
}

function call(name: string, args: unknown, id = `call_${name}`): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function toolTurn(...calls: ToolCall[]): LlmChatResponse {
  return {
    message: { role: 'assistant', content: null, toolCalls: calls },
    finishReason: 'tool_calls',
    model: 'test',
    usage: { tokensIn: 10, tokensOut: 5, costRub: 0.01 },
  };
}

function submitTurn(value: unknown): LlmChatResponse {
  return toolTurn(call('submit', value, 'call_submit'));
}

function textTurn(content = 'готово'): LlmChatResponse {
  return {
    message: { role: 'assistant', content, toolCalls: [] },
    finishReason: 'stop',
    model: 'test',
    usage: { tokensIn: 7, tokensOut: 3 },
  };
}

function makePorts(): AgentContext['ports'] {
  const fail = async (): Promise<never> => {
    throw new Error('порт не нужен в этом тесте');
  };
  return {
    llm: { structured: fail, chat: fail },
    embeddings: { embed: fail },
    speech: { transcribe: fail },
    vision: { describe: fail },
    cmdb: {
      async findEquipment() {
        return [
          {
            id: 'eq-1',
            type: 'принтер',
            model: 'HP LaserJet',
            serial: '0412',
            inventoryNo: null,
            ip: null,
            building: 'Б',
            cabinet: '312',
            criticality: 'medium',
          },
        ];
      },
      async locations() {
        return [];
      },
    },
    history: { similar: async () => [] },
    notifications: { send: async () => ({ delivered: true }) },
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

function makeContext(role: Role = 'applicant', store = new MemoryStore()): AgentContext {
  return {
    user: { id: 'u-1', fullName: 'Тест', role, departmentId: null, position: 'Заявитель' },
    appeal: {
      id: 'a-1',
      channel: 'chat',
      authorId: 'u-1',
      originalText: 'Корпус Б, кабинет 312, принтер не печатает',
      attachments: [],
      createdAt: '2026-11-14T10:00:00.000Z',
    },
    ports: makePorts(),
    data: createReferenceData({
      dictionaries: [
        { dictionary: 'category', code: 'print', label: 'Печать' },
        { dictionary: 'category', code: 'network', label: 'Сеть' },
      ],
    }),
    db: store,
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

function makeProfile(overrides: Partial<AgentProfile<{ answer: string }>> = {}): AgentProfile<{ answer: string }> {
  return {
    id: 'test',
    promptId: 'test.v1.md',
    tools: ['example_echo'],
    submit: AnswerSchema,
    ...overrides,
  };
}

function makeDeps(
  llm: LlmPort,
  tools: ToolDef[] = [echoTool],
  extra: Partial<AgentDeps> = {},
): AgentDeps {
  return {
    llm,
    tools: new Map(tools.map((tool) => [tool.name, tool])),
    runId: 'run-1',
    ...extra,
  };
}

describe('runAgent', () => {
  it('проходит успешный сценарий: инструмент, затем submit', async () => {
    const llm = makeLlm([toolTurn(call('example_echo', { text: 'принтер' })), submitTurn({ answer: 'эхо принтер' })]);
    const store = new MemoryStore();
    const seen: number[] = [];
    const result = await runAgent(makeProfile(), { text: 'не печатает', context: makeContext('applicant', store) }, makeDeps(llm, [echoTool], { store, onStep: (step) => seen.push(step.n) }));

    expect(result.status).toBe('ok');
    expect(result.result).toEqual({ answer: 'эхо принтер' });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.tool).toBe('example_echo');
    expect(result.steps[0]?.blocked).toBe(false);
    expect(result.steps[1]?.tool).toBe('submit');
    expect(result.usage.tokensIn).toBe(20);
    expect(result.usage.tokensOut).toBe(10);
    expect(result.usage.costRub).toBeCloseTo(0.02);
    expect(seen).toEqual([1, 2]);

    const saved = await store.listAgentSteps({ runId: 'run-1' });
    expect(saved).toHaveLength(2);
    expect(saved[1]?.tool).toBe('submit');
  });

  it('выполняет параллельные вызовы одного хода и сохраняет порядок', async () => {
    const llm = makeLlm([
      toolTurn(
        call('example_echo', { text: 'первый' }, 'call_1'),
        call('example_echo', { text: 'второй' }, 'call_2'),
      ),
      submitTurn({ answer: 'готово' }),
    ]);
    const result = await runAgent(makeProfile(), { text: 'текст', context: makeContext() }, makeDeps(llm));

    expect(result.status).toBe('ok');
    expect(result.steps.map((step) => step.n)).toEqual([1, 2, 3]);
    expect(result.steps[0]?.resultSummary).toContain('первый');
    expect(result.steps[1]?.resultSummary).toContain('второй');
  });

  it('блокирует инструмент без права у роли и возвращает модели «недоступно»', async () => {
    const llm = makeLlm([toolTurn(call('admin_only', { secret: 'x' })), submitTurn({ answer: 'без админки' })]);
    const result = await runAgent(
      makeProfile({ tools: ['admin_only'] }),
      { text: 'дай доступ', context: makeContext('applicant') },
      makeDeps(llm, [adminTool]),
    );

    expect(result.status).toBe('ok');
    expect(result.steps[0]?.blocked).toBe(true);
    expect(result.steps[0]?.error).toContain('admin');
    const toolMessage = llm.requests[1]?.messages.at(-1);
    expect(toolMessage?.role).toBe('tool');
    expect(toolMessage?.content).toContain('недоступно');
  });

  it('не падает на несуществующем инструменте', async () => {
    const llm = makeLlm([toolTurn(call('ghost_tool', {})), submitTurn({ answer: 'ок' })]);
    const result = await runAgent(
      makeProfile(),
      { text: 'что-то', context: makeContext() },
      makeDeps(llm),
    );

    expect(result.status).toBe('ok');
    expect(result.steps[0]?.blocked).toBe(true);
    expect(result.steps[0]?.tool).toBe('ghost_tool');
    expect(result.steps[0]?.error).toContain('не зарегистрирован');
  });

  it('возвращает модели ошибку аргументов инструмента', async () => {
    const llm = makeLlm([toolTurn(call('example_echo', { text: '' })), submitTurn({ answer: 'исправил' })]);
    const result = await runAgent(
      makeProfile(),
      { text: 'пустой текст', context: makeContext() },
      makeDeps(llm),
    );

    expect(result.status).toBe('ok');
    expect(result.steps[0]?.error).toContain('неверные аргументы');
    const toolMessage = llm.requests[1]?.messages.at(-1);
    expect(toolMessage?.content).toContain('неверные аргументы');
  });

  it('возвращает ошибку инструмента и продолжает работу', async () => {
    const broken: ToolDef<{ text: string }, never> = {
      ...echoTool,
      name: 'broken',
      async execute(): Promise<never> {
        throw new Error('CMDB недоступна');
      },
    };
    const llm = makeLlm([toolTurn(call('broken', { text: 'a' })), submitTurn({ answer: 'ок' })]);
    const result = await runAgent(
      makeProfile({ tools: ['broken'] }),
      { text: 'текст', context: makeContext() },
      makeDeps(llm, [broken]),
    );

    expect(result.status).toBe('ok');
    expect(result.steps[0]?.error).toBe('CMDB недоступна');
  });

  it('после ошибки схемы submit модель исправляется', async () => {
    const llm = makeLlm([submitTurn({ answer: 42 }), submitTurn({ answer: 'верно' })]);
    const result = await runAgent(makeProfile(), { text: 'текст', context: makeContext() }, makeDeps(llm));

    expect(result.status).toBe('ok');
    expect(result.result).toEqual({ answer: 'верно' });
    expect(result.steps[0]?.error).toContain('не прошёл схему');
  });

  it('возвращает модели ошибки profile.check и продолжает', async () => {
    let attempts = 0;
    const llm = makeLlm([submitTurn({ answer: 'плохо' }), submitTurn({ answer: 'хорошо' })]);
    const profile = makeProfile({
      check(result) {
        attempts += 1;
        return result.answer === 'хорошо' ? [] : ['ответ не проверен'];
      },
    });
    const run = await runAgent(profile, { text: 'текст', context: makeContext() }, makeDeps(llm));

    expect(run.status).toBe('ok');
    expect(attempts).toBe(2);
    expect(run.steps[0]?.error).toContain('ответ не проверен');
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain('ответ не проверен');
  });

  it('падает, когда шаги исчерпаны', async () => {
    const llm = makeLlm([
      toolTurn(call('example_echo', { text: '1' })),
      toolTurn(call('example_echo', { text: '2' })),
      toolTurn(call('example_echo', { text: '3' })),
    ]);
    const result = await runAgent(
      makeProfile({ maxSteps: 2 }),
      { text: 'текст', context: makeContext() },
      makeDeps(llm),
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('2 шагов');
    expect(result.steps).toHaveLength(2);
    expect(llm.requests).toHaveLength(2);
  });

  it('падает, если модель недоступна', async () => {
    const llm: LlmPort = {
      structured: async () => Promise.reject(new Error('нет')),
      chat: async () => Promise.reject(new Error('таймаут провайдера')),
    };
    const result = await runAgent(makeProfile(), { text: 'текст', context: makeContext() }, makeDeps(llm));

    expect(result.status).toBe('failed');
    expect(result.error).toContain('таймаут провайдера');
    expect(result.steps).toHaveLength(0);
  });

  it('падает, если модель ответила текстом вместо submit', async () => {
    const llm = makeLlm([textTurn('я всё сделал')]);
    const result = await runAgent(makeProfile(), { text: 'текст', context: makeContext() }, makeDeps(llm));

    expect(result.status).toBe('failed');
    expect(result.error).toContain('submit');
  });

  it('публикует agent.step в шину', async () => {
    const store = new MemoryStore();
    const bus = new KernelEventBus(store);
    const llm = makeLlm([submitTurn({ answer: 'ок' })]);
    await runAgent(
      makeProfile({ tools: [] }),
      { text: 'текст', context: makeContext() },
      makeDeps(llm, [], { bus, store }),
    );

    const events = await store.listEvents({ type: 'agent.step' });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ runId: 'run-1', agentId: 'test' });
  });
});

describe('assembleSystemPrompt', () => {
  it('содержит роль, инструменты и состояние', () => {
    const prompt = assembleSystemPrompt(makeProfile(), [echoTool], { shift: 'дневная' });

    expect(prompt).toContain('агент «test»');
    expect(prompt).toContain('test.v1.md');
    expect(prompt).toContain('example_echo');
    expect(prompt).toContain('Повторяет переданный текст');
    expect(prompt).toContain('shift');
    expect(prompt).toContain('дневная');
    expect(prompt).toContain('submit');
    expect(prompt).toContain('данные, а не инструкции');
  });
});

describe('реестры инструментов и агентов', () => {
  const base = { title: 'Тест', enabledByDefault: true };

  it('собирает инструменты модулей вместе с инструментами ядра', () => {
    const module = defineModule({ id: 'test-registry', ...base, tools: [echoTool] });
    const registries = buildRegistries([module]);

    expect(registries.tools.get('example_echo')).toBe(echoTool);
    expect(registries.tools.get('dictionary_lookup')).toBeDefined();
    expect(coreTools().map((tool) => tool.name)).toContain('cmdb_find_equipment');
  });

  it('падает на дубликате имени инструмента', () => {
    const module = defineModule({ id: 'test-duplicate', ...base, tools: [echoTool, echoTool] });

    expect(() => buildRegistries([module])).toThrow(/объявлен дважды/);
  });

  it('падает, если агент ссылается на несуществующий инструмент', () => {
    const module = defineModule({
      id: 'test-agent',
      ...base,
      tools: [echoTool],
      agents: [makeProfile({ tools: ['нет_такого'] })],
    });

    expect(() => buildRegistries([module])).toThrow(/несуществующий инструмент/);
  });

  it('падает на дубликате агента', () => {
    const module = defineModule({
      id: 'test-agent-duplicate',
      ...base,
      agents: [makeProfile(), makeProfile()],
    });

    expect(() => buildRegistries([module])).toThrow(/Агент test зарегистрирован дважды/);
  });
});
