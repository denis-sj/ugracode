import type { RunStreamEvent } from '@ugra/contracts';

/** Человеческие подписи инструментов: заявитель не должен видеть имена API и служебные детали. */
const TOOL_LABELS: Record<string, string> = {
  cmdb_find_equipment: 'Ищу оборудование в базе',
  cmdb_list_locations: 'Уточняю расположение',
  dictionary_lookup: 'Смотрю справочник',
  kb_search: 'Ищу в базе знаний',
  kb_get_article: 'Читаю статью базы знаний',
  tickets_find_similar: 'Смотрю похожие заявки',
  example_echo: 'Проверяю данные',
  submit: 'Собираю результат',
};

const FALLBACK_LABEL = 'Обрабатываю данные';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Убирает почты, UUID, инвентарные номера, телефоны и длинные идентификаторы. */
export function sanitizeSummary(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\b[A-ZА-ЯЁ]{2,}[-‐ ]?\d{3,}\b/g, '')
    .replace(/\b\d{10,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 100);
}

/** Событие шины `agent.step` → безопасная запись журнала для заявителя. */
export function traceEventFromBus(payload: unknown, runId: string, appealId: string): RunStreamEvent | null {
  const data = asRecord(payload);
  const phase = data.phase;
  const n = typeof data.n === 'number' ? data.n : undefined;
  const tool = typeof data.tool === 'string' ? data.tool : undefined;

  if (phase === 'running') {
    if (!n) return null;
    return {
      type: 'agent.step',
      runId,
      appealId,
      n,
      tool,
      label: (tool ? TOOL_LABELS[tool] : undefined) ?? FALLBACK_LABEL,
      status: 'running',
    };
  }

  const step = asRecord(data.step);
  const stepN = typeof step.n === 'number' ? step.n : n;
  if (!stepN) return null;
  const stepTool = typeof step.tool === 'string' ? step.tool : tool;
  const label = (stepTool ? TOOL_LABELS[stepTool] : undefined) ?? FALLBACK_LABEL;
  const blocked = step.blocked === true;
  const failed = typeof step.error === 'string' && step.error !== '';
  const rawSummary = typeof step.resultSummary === 'string' ? step.resultSummary : '';
  const summary = blocked ? 'проверка пропущена' : failed ? 'не удалось выполнить' : sanitizeSummary(rawSummary);
  return {
    type: 'agent.step',
    runId,
    appealId,
    n: stepN,
    tool: stepTool,
    label,
    summary,
    durationMs: typeof step.durationMs === 'number' ? step.durationMs : 0,
    status: blocked ? 'blocked' : failed ? 'error' : 'done',
  };
}
