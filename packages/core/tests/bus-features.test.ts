import { describe, expect, it } from 'vitest';
import { KernelEventBus } from '../src/bus';
import { MemoryStore } from '../src/storage';
import { isModuleEnabled, parseModuleList, resolveEnabledModules } from '../src/features';
import { defineModule } from '../src/module';
import { missingFields } from '../src/core-steps';
import type { FieldDef } from '@ugra/contracts';

const sample = defineModule({ id: 'sample', title: 'Образец', enabledByDefault: true });
const off = defineModule({ id: 'raw', title: 'Сырой', enabledByDefault: false });

describe('шина событий', () => {
  it('пишет событие в журнал и рассылает подписчикам', async () => {
    const store = new MemoryStore();
    const bus = new KernelEventBus(store);
    const received: string[] = [];
    bus.subscribe('ticket.confirmed', (event) => {
      received.push(event.type);
    });
    await bus.publish({ type: 'ticket.confirmed', actor: { kind: 'system' }, payload: {} });
    expect(received).toEqual(['ticket.confirmed']);
    expect(await store.listEvents()).toHaveLength(1);
  });

  it('ошибка подписчика не мешает другим', async () => {
    const bus = new KernelEventBus();
    const received: string[] = [];
    bus.subscribe('*', () => {
      throw new Error('подписчик сломан');
    });
    bus.subscribe('*', () => {
      received.push('ok');
    });
    await expect(bus.publish({ type: 'x', actor: { kind: 'system' }, payload: {} })).resolves.toBeUndefined();
    expect(received).toEqual(['ok']);
  });

  it('отписка прекращает доставку', async () => {
    const bus = new KernelEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe('x', () => {
      received.push('x');
    });
    unsubscribe();
    await bus.publish({ type: 'x', actor: { kind: 'system' }, payload: {} });
    expect(received).toEqual([]);
  });
});

describe('флаги фич', () => {
  it('по умолчанию берёт enabledByDefault', () => {
    expect(isModuleEnabled(sample, {})).toBe(true);
    expect(isModuleEnabled(off, {})).toBe(false);
  });

  it('FEATURES_OFF выключает, FEATURES_ON включает', () => {
    expect(isModuleEnabled(sample, { FEATURES_OFF: 'sample' })).toBe(false);
    expect(isModuleEnabled(off, { FEATURES_ON: 'raw' })).toBe(true);
    expect(isModuleEnabled(off, { FEATURES_ON: 'raw', FEATURES_OFF: 'raw' })).toBe(true);
  });

  it('разбирает список с пробелами', () => {
    expect(parseModuleList(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(parseModuleList(undefined)).toEqual([]);
  });

  it('делит модули на включённые и выключенные', () => {
    const result = resolveEnabledModules([sample, off], { FEATURES_OFF: 'sample' });
    expect(result.enabled.map((module) => module.id)).toEqual([]);
    expect(result.disabled).toEqual(['sample', 'raw']);
  });
});

const field: FieldDef = {
  key: 'cabinet',
  label: 'Кабинет',
  group: 'location',
  type: 'string',
  required: true,
  extractHint: 'номер',
  ask: { question: 'Какой кабинет?', widget: 'text' },
  evalMode: 'exact',
};

describe('недостающие поля', () => {
  it('находит пустое обязательное поле и строит вопрос', () => {
    const missing = missingFields([field], {});
    expect(missing).toHaveLength(1);
    expect(missing[0]?.question).toBe('Какой кабинет?');
    expect(missing[0]?.widget).toBe('text');
  });

  it('не считает заполненное поле недостающим', () => {
    expect(missingFields([field], { cabinet: { value: '312' } })).toEqual([]);
  });

  it('игнорирует необязательные поля', () => {
    expect(missingFields([{ ...field, required: false }], {})).toEqual([]);
  });
});
