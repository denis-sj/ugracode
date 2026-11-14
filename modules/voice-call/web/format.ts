/** Звонок, как его отдаёт `GET /api/m/voice-call/calls` (схема — `server/view.ts`). */
export interface CallLineView {
  speaker: 'caller' | 'ai';
  text: string;
  at: string;
  source?: 'ai' | 'fallback' | 'rule';
  ms?: number;
}

export interface CallView {
  id: string;
  from: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt: string | null;
  emergency: boolean;
  ticketId: string | null;
  ticketNumber: string | null;
  lines: CallLineView[];
}

export const CALLS_URL = '/api/m/voice-call/calls';
/** Опрос раз в секунду: реплики появляются почти вживую без отдельного потока. */
export const POLL_MS = 1000;

/** Звонок для главной карточки: идущий сейчас, иначе последний. */
export function pickCall(calls: readonly CallView[], selectedId: string | null): CallView | null {
  if (selectedId) {
    const selected = calls.find((call) => call.id === selectedId);
    if (selected) return selected;
  }
  return calls.find((call) => call.status === 'active') ?? calls[0] ?? null;
}

/** Длительность «м:сс». Для идущего звонка — до текущего момента. */
export function duration(call: Pick<CallView, 'startedAt' | 'endedAt'>, now: number): string {
  const end = call.endedAt ? Date.parse(call.endedAt) : now;
  const seconds = Math.max(0, Math.floor((end - Date.parse(call.startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** «+79120001122» → «+7 912 000-11-22»; прочее — как есть, пустое и скрытое — «номер скрыт». */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim() === '' || raw.toLowerCase() === 'anonymous') return 'номер скрыт';
  const local = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (!local) return raw.trim();
  return `+7 ${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8)}`;
}

/** Подпись под репликой ИИ: откуда фраза и сколько думала модель. */
export function sourceLabel(line: CallLineView): string | null {
  if (line.speaker !== 'ai') return null;
  if (line.source === 'fallback') return 'запасная фраза: модель не успела';
  if (line.source === 'rule') return 'правило: без модели';
  if (line.source === 'ai') return line.ms ? `ИИ · ${(line.ms / 1000).toFixed(1)} с` : 'ИИ';
  return null;
}

export function statusText(call: CallView): string {
  if (call.status === 'active') return 'Идёт разговор';
  return call.ticketNumber ? `Заявка ${call.ticketNumber}` : 'Звонок завершён';
}
