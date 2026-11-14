import { randomUUID } from 'node:crypto';
import type { DomainEvent, EventBus, EventHandler, NewEvent } from '@ugra/contracts';
import type { EventFilter, KernelStore } from './storage';

/** Шина: событие сначала пишется в журнал, затем рассылается подписчикам. */
export class KernelEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly history: DomainEvent[] = [];

  constructor(private readonly store?: KernelStore) {}

  async publish(event: NewEvent): Promise<void> {
    const stored: DomainEvent = { ...event, id: event.id ?? randomUUID(), at: event.at ?? new Date().toISOString() };
    if (this.store) await this.store.appendEvent(stored);
    else this.history.push(stored);
    await this.dispatch(stored);
  }

  subscribe(type: string, handler: EventHandler): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Подписчики получают события по порядку; ошибка подписчика не ломает основное действие. */
  private async dispatch(event: DomainEvent): Promise<void> {
    const targets = [...(this.handlers.get(event.type) ?? [])];
    const catchAll = [...(this.handlers.get('*') ?? [])];
    for (const handler of [...targets, ...catchAll]) {
      try {
        await handler(event);
      } catch {
        // ошибка подписчика не должна ломать основное действие (раздел 3.3 спецификации)
      }
    }
  }

  async readEvents(filter: EventFilter = {}): Promise<DomainEvent[]> {
    if (this.store) return this.store.listEvents(filter);
    return this.history;
  }
}
