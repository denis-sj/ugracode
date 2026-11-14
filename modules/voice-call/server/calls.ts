/** Кто говорит в звонке: заявитель или ИИ-оператор. */
export type Speaker = 'caller' | 'ai';

/** Откуда фраза ИИ: модель, запасная фраза (таймаут или сбой), правило кода (авария, лимит). */
export type ReplySource = 'ai' | 'fallback' | 'rule';

export interface CallLine {
  speaker: Speaker;
  text: string;
  at: string;
  source?: ReplySource;
  /** Сколько думала модель, мс (только у реплик ИИ). */
  ms?: number;
}

export interface CallRecord {
  id: string;
  from: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt: string | null;
  lines: CallLine[];
  emergency: boolean;
  appealId: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  /** Что ИИ сказал на прощание: повторный `end` отдаёт ту же фразу. */
  farewell: string | null;
}

/** Состояние звонков живёт в памяти процесса: звонок короткий, итог сохраняется заявкой. */
export const CALL_TTL_MS = 30 * 60 * 1000;

export class CallStore {
  private readonly calls = new Map<string, CallRecord>();

  constructor(
    private readonly now: () => Date,
    private readonly ttlMs = CALL_TTL_MS,
  ) {}

  get(id: string): CallRecord | null {
    this.sweep();
    return this.calls.get(id) ?? null;
  }

  /** Звонок по id или новый: страница звонка не делает отдельного запроса на начало звонка. */
  open(id: string, from: string): CallRecord {
    const existing = this.get(id);
    if (existing) return existing;
    const call: CallRecord = {
      id,
      from,
      status: 'active',
      startedAt: this.now().toISOString(),
      endedAt: null,
      lines: [],
      emergency: false,
      appealId: null,
      ticketId: null,
      ticketNumber: null,
      farewell: null,
    };
    this.calls.set(id, call);
    return call;
  }

  /** Свежие звонки сверху: активные и закончившиеся в пределах TTL. */
  list(): CallRecord[] {
    this.sweep();
    return [...this.calls.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private sweep(): void {
    const border = this.now().getTime() - this.ttlMs;
    for (const [id, call] of this.calls) {
      const last = call.endedAt ?? call.lines.at(-1)?.at ?? call.startedAt;
      if (Date.parse(last) < border) this.calls.delete(id);
    }
  }
}
