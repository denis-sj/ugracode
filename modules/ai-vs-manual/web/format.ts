import type { DictionaryItem, FieldDef, FieldOrigin, TicketField } from '@ugra/contracts';

/**
 * Чистые функции замера К4 «с ИИ / без ИИ»: считают итог по сессиям, проценты экономии
 * и собирают строки полей. Ни DOM, ни сети — поэтому тестируются без браузера.
 */

export type MeasureMode = 'manual' | 'ai';

/** Одна сессия замера: сколько действий и секунд ушло на одну и ту же заявку. */
export interface MeasureSession {
  id: string;
  mode: MeasureMode;
  /** Сколько действий насчитал `useActionCounter` (финальный клик «Готово» учтён). */
  actions: number;
  /** Время от старта до «Готово», секунды. */
  seconds: number;
  /** Сколько полей заполнено вручную или проверено в карточке ИИ. */
  fields: number;
  createdAt: string;
  /** Данные для показа на защите, а не настоящий замер. */
  demo?: boolean;
}

export interface ModeStats {
  sessions: number;
  /** Среднее по сессиям — именно эти цифры идут в итог «N против M». */
  actions: number;
  seconds: number;
  fields: number;
  totalActions: number;
  totalSeconds: number;
  totalFields: number;
  /** Хотя бы одна сессия режима помечена как демо-данные. */
  demo: boolean;
}

export interface MeasureSummary {
  manual: ModeStats;
  ai: ModeStats;
  /** Положительное значение — ИИ потребовал меньше; отрицательное — больше. */
  actionsSaved: number;
  secondsSaved: number;
  /** Экономия действий в процентах от ручного режима; может быть отрицательной. */
  actionsPercent: number;
  timePercent: number;
  /** Во сколько раз быстрее по действиям; 0 — сравнить нельзя. */
  speedup: number;
  /** Есть по одному замеру в каждом режиме. */
  ready: boolean;
  demo: boolean;
}

export interface AiFieldRow {
  key: string;
  label: string;
  value: string | null;
  confidence: number | null;
  quote: string | null;
  origin: FieldOrigin | null;
  needsReview: boolean;
}

/** Больше 50 сессий в браузере не держим: это замер, а не журнал. */
export const MAX_SESSIONS = 50;
/** В ручной форме 5–7 полей: берём до семи, обязательные первыми. */
export const MANUAL_FIELD_LIMIT = 7;

function toNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** Одна сессия из localStorage: мусор и отрицательные значения отбрасываем. */
function toSession(value: unknown): MeasureSession | null {
  if (!isRecord(value)) return null;
  const mode = value.mode;
  if (mode !== 'manual' && mode !== 'ai') return null;
  const id = nonEmptyString(value.id);
  const createdAt = nonEmptyString(value.createdAt);
  const actions = toNumber(value.actions);
  const seconds = toNumber(value.seconds);
  const fields = value.fields === undefined ? 0 : toNumber(value.fields);
  if (id === null || createdAt === null || actions === null || seconds === null || fields === null) return null;
  if (actions < 0 || seconds < 0 || fields < 0) return null;
  return {
    id,
    mode,
    actions,
    seconds,
    fields,
    createdAt,
    demo: value.demo === true,
  };
}

/**
 * Разбор сохранённых сессий: принимает строку JSON или массив, битые строки выбрасывает.
 * Никогда не бросает — испорченный localStorage не должен ломать экран.
 */
export function parseSessions(raw: unknown): MeasureSession[] {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const sessions: MeasureSession[] = [];
  for (const entry of value) {
    const session = toSession(entry);
    if (session !== null) sessions.push(session);
    if (sessions.length >= MAX_SESSIONS) break;
  }
  return sessions;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function statsFor(sessions: readonly MeasureSession[]): ModeStats {
  const totalActions = sessions.reduce((sum, session) => sum + session.actions, 0);
  const totalSeconds = round1(sessions.reduce((sum, session) => sum + session.seconds, 0));
  const totalFields = sessions.reduce((sum, session) => sum + session.fields, 0);
  const count = sessions.length;
  return {
    sessions: count,
    actions: count === 0 ? 0 : Math.round(totalActions / count),
    seconds: count === 0 ? 0 : round1(totalSeconds / count),
    fields: count === 0 ? 0 : Math.round(totalFields / count),
    totalActions,
    totalSeconds,
    totalFields,
    demo: sessions.some((session) => session.demo === true),
  };
}

/** Итог по режимам: среднее по сохранённым замерам. Битые записи не ломают счёт. */
export function tally(sessions: readonly MeasureSession[]): { manual: ModeStats; ai: ModeStats } {
  const valid = parseSessions(sessions);
  return {
    manual: statsFor(valid.filter((session) => session.mode === 'manual')),
    ai: statsFor(valid.filter((session) => session.mode === 'ai')),
  };
}

/**
 * Процент экономии относительно ручного режима: `(база − значение) / база × 100`.
 * База 0 или мусор — 0; ИИ дороже ручного — отрицательный процент, не «ноль ради красоты».
 */
export function savingsPercent(baseline: number, value: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(value) || baseline <= 0) return 0;
  const percent = ((baseline - value) / baseline) * 100;
  return Math.max(-100, Math.round(percent));
}

/** Во сколько раз быстрее: 47 и 6 действий → 7,8. Ноль и мусор — 0. */
export function speedup(baseline: number, value: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(value) || baseline <= 0 || value <= 0) return 0;
  return round1(baseline / value);
}

/** «38 с», «3 мин 34 с»; отрицательное, NaN и пустое — «0 с». */
export function formatSeconds(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (total < 60) return `${total} с`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${String(rest).padStart(2, '0')} с`;
}

/** Итог сравнения двух колонок. Пустые данные дают нули и `ready: false`. */
export function summarizeSessions(sessions: readonly MeasureSession[]): MeasureSummary {
  const { manual, ai } = tally(sessions);
  return {
    manual,
    ai,
    actionsSaved: manual.actions - ai.actions,
    secondsSaved: round1(manual.seconds - ai.seconds),
    actionsPercent: savingsPercent(manual.actions, ai.actions),
    timePercent: savingsPercent(manual.seconds, ai.seconds),
    speedup: speedup(manual.actions, ai.actions),
    ready: manual.sessions > 0 && ai.sessions > 0,
    demo: manual.demo || ai.demo,
  };
}

function isRequired(def: FieldDef): boolean {
  return def.required === true || (typeof def.required === 'object' && def.required !== null);
}

/**
 * Поля ручной формы: из того же реестра, что и у ИИ, но без подсказок.
 * Обязательные идут первыми, всего не больше `limit` — 5–7 полей хватает для честного замера.
 */
export function pickMeasureFields(defs: readonly FieldDef[], limit: number = MANUAL_FIELD_LIMIT): FieldDef[] {
  if (!Array.isArray(defs) || defs.length === 0) return [];
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MANUAL_FIELD_LIMIT;
  if (safeLimit === 0) return [];
  const required = defs.filter(isRequired);
  const optional = defs.filter((def) => !isRequired(def));
  return [...required, ...optional].slice(0, safeLimit);
}

/** Значение поля для человека: код справочника → подпись, пустое → `null`. */
export function displayFieldValue(
  defs: readonly FieldDef[],
  dictionaries: readonly Pick<DictionaryItem, 'dictionary' | 'code' | 'label'>[],
  key: string,
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const def = defs.find((entry) => entry.key === key);
  if (!def || def.type !== 'dictionary' || !def.dictionary) return text;
  return dictionaries.find((item) => item.dictionary === def.dictionary && item.code === text)?.label ?? text;
}

/** Варианты поля-справочника для ручной формы. */
export function dictionaryOptions(
  def: FieldDef | null | undefined,
  dictionaries: readonly Pick<DictionaryItem, 'dictionary' | 'code' | 'label'>[],
): Array<{ code: string; label: string }> {
  if (!def || def.type !== 'dictionary' || !def.dictionary) return [];
  return dictionaries
    .filter((item) => item.dictionary === def.dictionary)
    .map((item) => ({ code: item.code, label: item.label }));
}

/** Поля для колонки «С ИИ»: порядок реестра, справочники — подписями, уверенность и цитата. */
export function aiFieldRows(
  defs: readonly FieldDef[],
  dictionaries: readonly Pick<DictionaryItem, 'dictionary' | 'code' | 'label'>[],
  fields: readonly TicketField[],
  limit: number = MANUAL_FIELD_LIMIT,
): AiFieldRow[] {
  if (!Array.isArray(defs) || !Array.isArray(fields)) return [];
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MANUAL_FIELD_LIMIT;
  if (safeLimit === 0) return [];
  const rows: AiFieldRow[] = [];
  for (const def of defs) {
    const field = fields.find((entry) => entry.fieldKey === def.key);
    if (!field) continue;
    rows.push({
      key: def.key,
      label: def.label,
      value: displayFieldValue(defs, dictionaries, def.key, field.value),
      confidence: Number.isFinite(field.confidence) ? field.confidence : null,
      quote: field.quote?.text ?? null,
      origin: field.origin,
      needsReview: field.needsReview === true,
    });
    if (rows.length >= safeLimit) break;
  }
  return rows;
}

/** Предзаполненные цифры для `?demo=1`: пример заказчика, помечены как демо-данные. */
export function demoSessions(now: Date | number = Date.now()): MeasureSession[] {
  const date = now instanceof Date ? now : new Date(now);
  const createdAt = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return [
    {
      id: 'demo-manual',
      mode: 'manual',
      actions: 47,
      seconds: 214,
      fields: 6,
      createdAt,
      demo: true,
    },
    {
      id: 'demo-ai',
      mode: 'ai',
      actions: 6,
      seconds: 38,
      fields: 6,
      createdAt,
      demo: true,
    },
  ];
}
