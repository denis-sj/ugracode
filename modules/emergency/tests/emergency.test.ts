import { describe, expect, it } from 'vitest';
import type { AnalysisDraft, EventBus, NewEvent } from '@ugra/contracts';
import {
  MemoryStore,
  createReferenceData,
  type Ports,
  type StepContext,
  type StepProgress,
} from '@ugra/core';
import emergency from '../server';
import {
  readEmergencyEngineers,
  readEmergencyRules,
  type EmergencyRulesFile,
} from '../contracts';
import {
  detectEmergency,
  pickDutyEngineers,
  ruleSigns,
} from '../server/detect';
import { evaluateEmergency } from '../server/evaluate';

const now = new Date('2026-11-14T10:00:00.000Z');

const rulesRaw = {
  rules: [
    {
      id: 'emergency.fire',
      title: 'Пожар, дым, запах горелого',
      level: 'critical',
      checklistId: 'fire',
      signs: ['smoke', 'burning_smell'],
      patterns: ['дым', 'горит', 'запах жжён'],
    },
    {
      id: 'emergency.network',
      title: 'Отказ сети для многих',
      level: 'critical',
      checklistId: 'network',
      checklist: ['Позвоните дежурному по сети.'],
      signs: ['network_outage'],
      patterns: ['нет сети', 'упал сервер'],
      skills: ['network'],
    },
  ],
  checklists: [
    { id: 'fire', title: 'Дым', steps: ['Обесточьте оборудование.', 'Позвоните 112.'] },
    { id: 'network', title: 'Сеть', steps: ['Не перезагружайте коммутаторы.', 'Сообщите корпуса.'] },
  ],
};

const rules: EmergencyRulesFile = readEmergencyRules(rulesRaw);

const engineers = readEmergencyEngineers({
  engineers: [
    { id: 'u-network', fullName: 'Дежурный по сети', skills: [{ skill: 'network', level: 5 }], onShift: true },
    { id: 'u-printer', fullName: 'Дежурный по печати', skills: [{ skill: 'printer', level: 3 }], onShift: true },
    { id: 'u-night', fullName: 'Ночная смена сети', skills: [{ skill: 'network', level: 4 }], onShift: false },
  ],
});

const modelSignal = {
  extraction: {
    emergency: {
      suspected: true,
      signs: [{ sign: 'smoke', quote: 'идёт дым' }],
      confidence: 0.95,
    },
  },
};

const appeal = {
  id: 'a-1',
  channel: 'chat' as const,
  authorId: 'u-1',
  originalText: 'В кабинете идёт дым',
  attachments: [],
  createdAt: now.toISOString(),
};

function draft(text: string, ext: Record<string, unknown> = {}): AnalysisDraft {
  return {
    sources: [{ id: 'source-1', kind: 'text', text }],
    fields: {},
    missing: [],
    ext,
  };
}

function ports(sent: { toUserId: string }[] = [], fail = false): Ports {
  return {
    llm: {
      structured: async () => Promise.reject(new Error('не нужен')),
      chat: async () => Promise.reject(new Error('не нужен')),
    },
    embeddings: { embed: async () => [] },
    speech: { transcribe: async () => ({ text: '' }) },
    vision: { describe: async () => ({ text: '' }) },
    cmdb: { findEquipment: async () => [], locations: async () => [] },
    history: { similar: async () => [] },
    notifications: {
      async send(notification) {
        if (fail) throw new Error('канал недоступен');
        sent.push({ toUserId: notification.toUserId });
        return { delivered: true };
      },
    },
    tts: { available: false, speak: () => Promise.reject(new Error('tts не нужен')) },
    clock: { now: () => now },
  };
}

function bus(events: NewEvent[]): EventBus {
  return {
    async publish(event) {
      events.push(event);
    },
    subscribe: () => () => undefined,
  };
}

function context(
  value: AnalysisDraft,
  options: {
    data?: ReturnType<typeof createReferenceData>;
    sent?: { toUserId: string }[];
    fail?: boolean;
    events?: NewEvent[];
    store?: MemoryStore;
    progress?: StepProgress[];
  } = {},
): StepContext {
  return {
    runId: 'run-1',
    appeal,
    draft: value,
    ports: ports(options.sent, options.fail),
    data: options.data ?? createReferenceData(),
    db: options.store,
    bus: options.events ? bus(options.events) : undefined,
    progress: (progress) => options.progress?.push(progress),
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

function dataWithRules(): ReturnType<typeof createReferenceData> {
  return createReferenceData({
    extra: { emergencyRules: rulesRaw, engineers: { engineers: [...engineers] } },
  });
}

describe('emergency: детектор', () => {
  it('правила и модель вместе дают подтверждённую аварию', () => {
    const verdict = detectEmergency({
      text: 'В кабинете идёт дым, пахнет жжёным',
      rules,
      engineers,
      ext: modelSignal,
    });

    expect(verdict.level).toBe('confirmed');
    expect(verdict.rulesMatched).toEqual(['emergency.fire']);
    expect(verdict.confidence).toBe(0.95);
    expect(verdict.checklist).toEqual(['Обесточьте оборудование.', 'Позвоните 112.']);
    expect(verdict.signs.some((sign) => sign.sign === 'smoke' && sign.quote === 'идёт дым')).toBe(true);
    expect(verdict.signs.some((sign) => sign.sign === 'emergency.fire')).toBe(true);
    expect(verdict.checklist.length).toBeGreaterThan(0);
  });

  it('только правила — авария под вопросом', () => {
    const verdict = detectEmergency({ text: 'В кабинете идёт дым', rules, engineers });

    expect(verdict.level).toBe('suspected');
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.rulesMatched).toEqual(['emergency.fire']);
    expect(verdict.signs.every((sign) => 'quote' in sign && sign.quote !== '')).toBe(true);
  });

  it('только модель — авария под вопросом', () => {
    const verdict = detectEmergency({ text: 'Принтер не печатает', rules, ext: modelSignal });

    expect(verdict.level).toBe('suspected');
    expect(verdict.rulesMatched).toEqual([]);
    expect(verdict.checklist).toEqual([]);
    expect(verdict.notifyUserIds).toEqual([]);
    expect(verdict.confidence).toBe(0.95);
  });

  it('нет ни правил, ни модели — аварии нет', () => {
    const verdict = detectEmergency({ text: 'Принтер не печатает', rules, engineers });

    expect(verdict).toEqual({
      level: 'none',
      signs: [],
      confidence: 0,
      rulesMatched: [],
      checklist: [],
      notifyUserIds: [],
    });
  });

  it('сравнивает без регистра и «ё», цитата берётся из текста как есть', () => {
    const text = 'Сначала ЗАПАХ ЖЖЁНОГО, потом дым';
    const verdict = detectEmergency({ text, rules });

    expect(verdict.level).toBe('suspected');
    expect(verdict.signs.length).toBeGreaterThan(0);
    for (const sign of verdict.signs) {
      expect(text.toLowerCase().replace(/ё/g, 'е')).toContain(sign.quote.toLowerCase().replace(/ё/g, 'е'));
    }
    expect(verdict.signs.map((sign) => sign.quote)).toContain('ЗАПАХ ЖЖЁН');
  });

  it('разные правила объединяют чек-листы без повторов', () => {
    const verdict = detectEmergency({ text: 'Идёт дым, нет сети во всём корпусе', rules });

    expect(verdict.rulesMatched).toEqual(['emergency.fire', 'emergency.network']);
    expect(verdict.checklist).toEqual([
      'Обесточьте оборудование.',
      'Позвоните 112.',
      'Позвоните дежурному по сети.',
      'Не перезагружайте коммутаторы.',
      'Сообщите корпуса.',
    ]);
    expect(new Set(verdict.checklist).size).toBe(verdict.checklist.length);
  });

  it('не находит слово внутри другого слова: «вода» не срабатывает на «провода»', () => {
    const short = readEmergencyRules({
      rules: [{ id: 'emergency.water', title: 'Вода', patterns: ['вода'] }],
    });

    expect(detectEmergency({ text: 'Искрят провода', rules: short }).rulesMatched).toEqual([]);
    expect(detectEmergency({ text: 'На полу вода', rules: short }).rulesMatched).toEqual(['emergency.water']);
  });

  it('битый шаблон правила не роняет разбор', () => {
    const short = readEmergencyRules({
      rules: [{ id: 'emergency.broken', title: 'Битое правило', patterns: ['[', 'дым'] }],
    });

    expect(detectEmergency({ text: 'Идёт дым', rules: short }).rulesMatched).toEqual(['emergency.broken']);
  });

  it('терпит отсутствие правил и мусор в ext', () => {
    expect(detectEmergency({ text: 'Дым', rules: readEmergencyRules(undefined) }).level).toBe('none');
    expect(detectEmergency({ text: 'Дым', rules, ext: { extraction: 'мусор' } }).level).toBe('suspected');
  });

  it('признаки знака-объекта подписаны кодом знака', () => {
    const short = readEmergencyRules({
      rules: [
        {
          id: 'emergency.fire',
          title: 'Дым',
          signs: [{ sign: 'smoke', words: ['дым'] }],
        },
      ],
    });
    const signs = ruleSigns(short.rules[0]!, 'Идёт дым');

    expect(signs).toEqual([{ sign: 'smoke', quote: 'дым' }]);
  });
});

describe('emergency: дежурные', () => {
  it('уведомляет на смене с навыком правила', () => {
    const network = rules.rules.filter((rule) => rule.id === 'emergency.network');

    expect(pickDutyEngineers(engineers, network)).toEqual(['u-network']);
  });

  it('правило без навыка уведомляет всех на смене, а не ночную смену', () => {
    const fire = rules.rules.filter((rule) => rule.id === 'emergency.fire');

    expect(pickDutyEngineers(engineers, fire)).toEqual(['u-network', 'u-printer']);
  });

  it('нет дежурного с навыком — не уведомляем никого', () => {
    const unknownSkill = readEmergencyRules({
      rules: [{ id: 'emergency.gas', title: 'Газ', patterns: ['газ'], skills: ['gas'] }],
    });

    expect(pickDutyEngineers(engineers, unknownSkill.rules)).toEqual([]);
  });
});

describe('emergency: метрика', () => {
  it('даёт 1, когда авария совпала с эталоном', () => {
    const value = draft('дым');
    value.emergency = detectEmergency({ text: 'Идёт дым', rules });

    expect(evaluateEmergency({ emergency: true }, value)).toEqual([
      { key: 'emergency_match', value: 1, expected: 'true', passed: true },
    ]);
  });

  it('даёт 0, когда авария пропущена или ложная', () => {
    const missed = evaluateEmergency({ emergency: true }, draft('принтер не печатает'));
    const falseAlarm = evaluateEmergency({ emergency: false }, {
      ...draft('дым'),
      emergency: detectEmergency({ text: 'Идёт дым', rules }),
    });

    expect(missed[0]?.value).toBe(0);
    expect(missed[0]?.passed).toBe(false);
    expect(falseAlarm[0]?.value).toBe(0);
  });

  it('без эталона метрик нет', () => {
    expect(evaluateEmergency({}, draft('дым'))).toEqual([]);
    expect(evaluateEmergency({ emergency: 'да' }, draft('дым'))).toEqual([]);
  });
});

describe('emergency: шаг разбора', () => {
  const step = emergency.steps[0]!;

  it('пишет вердикт, событие и уведомления дежурным', async () => {
    const sent: { toUserId: string }[] = [];
    const events: NewEvent[] = [];
    const progress: StepProgress[] = [];
    const store = new MemoryStore();

    const patch = await step.run(
      context(draft('Идёт дым, нет сети'), {
        data: dataWithRules(),
        sent,
        events,
        store,
        progress,
      }),
    );

    expect(patch?.emergency?.level).toBe('suspected');
    expect(sent.map((item) => item.toUserId)).toEqual(['u-network', 'u-printer']);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('emergency.detected');
    expect(events[0]?.ticketId).toBeUndefined();
    expect(events[0]?.payload).toMatchObject({
      level: 'suspected',
      rules: ['emergency.fire', 'emergency.network'],
    });
    expect(progress.at(-1)?.message).toBe('Авария: под вопросом');
    expect(await store.listNotifications('u-network')).toHaveLength(1);
    expect(await store.listNotifications('u-printer')).toHaveLength(1);
  });

  it('подтверждает аварию, когда модель согласна с правилами', async () => {
    const progress: StepProgress[] = [];
    const patch = await step.run(
      context(draft('Идёт дым', modelSignal), { data: dataWithRules(), progress }),
    );

    expect(patch?.emergency?.level).toBe('confirmed');
    expect(progress.at(-1)?.message).toBe('Авария: подтверждена');
  });

  it('ошибка канала уведомлений не валит шаг', async () => {
    const patch = await step.run(
      context(draft('Идёт дым'), { data: dataWithRules(), fail: true }),
    );

    expect(patch?.emergency?.level).toBe('suspected');
  });

  it('без правил и модели пишет «аварию нет» и никого не уведомляет', async () => {
    const sent: { toUserId: string }[] = [];
    const events: NewEvent[] = [];

    const patch = await step.run(context(draft('Принтер не печатает'), { sent, events }));

    expect(patch?.emergency?.level).toBe('none');
    expect(sent).toEqual([]);
    expect(events).toEqual([]);
  });

  it('без `ctx.db` и `ctx.bus` шаг работает', async () => {
    const sent: { toUserId: string }[] = [];
    const patch = await step.run(context(draft('Идёт дым'), { data: dataWithRules(), sent }));

    expect(patch?.emergency?.level).toBe('suspected');
    expect(sent).toHaveLength(2);
  });
});
