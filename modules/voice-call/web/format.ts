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

/** `GET /api/m/voice-call/public-url` (схема — `server/view.ts`). */
export interface PublicUrlView {
  url: string | null;
  callUrl: string | null;
  source: 'env' | 'tunnel' | null;
}

export const CALLS_URL = '/api/m/voice-call/calls';
export const PUBLIC_URL_URL = '/api/m/voice-call/public-url';
/** Опрос раз в секунду: реплики появляются почти вживую без отдельного потока. */
export const POLL_MS = 1000;
/** Адрес туннеля меняется — спрашиваем не чаще раза в 15 с. */
export const PUBLIC_URL_POLL_MS = 15_000;

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

/** Подпись звонящего: QR открыли с телефона или ноутбука — номер у нас не спрашивают. */
export function callerLabel(raw: string): string {
  const value = raw.trim();
  if (value === '' || value.toLowerCase() === 'anonymous') return 'устройство не определено';
  return value;
}

/** Кто звонит сейчас: карточка «входящий» показывает активный звонок. */
export function activeCall(calls: readonly CallView[]): CallView | null {
  return calls.find((call) => call.status === 'active') ?? null;
}

/**
 * Новый входящий звонок: активный, которого не было в прошлом опросе.
 * По нему диспетчеру показываем всплывающую плашку и короткий звук.
 */
export function findNewCall(previous: readonly CallView[], current: readonly CallView[]): CallView | null {
  const active = activeCall(current);
  if (!active) return null;
  const known = previous.some((call) => call.id === active.id && call.status === 'active');
  return known ? null : active;
}

/** Адрес страницы звонка из `GET /api/m/voice-call/public-url`; null — туннель не запущен. */
export function callUrlOf(publicUrl: { callUrl: string | null } | null): string | null {
  const url = publicUrl?.callUrl?.trim() ?? '';
  return url === '' ? null : url;
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
