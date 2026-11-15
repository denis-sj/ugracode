/**
 * Чистые функции хаба отчётов О1–О7.
 * Ответы сервера приходят как `unknown`: страница не падает на незнакомом формате,
 * а показывает JSON в `<details>`. Здесь — только чтение и форматирование, без DOM.
 */

export type ReportParamKind = 'days' | 'date';

export interface ReportSpec {
  /** id серверного модуля: из него собираются маршруты `run` и `export`. */
  readonly id: string;
  /** Код отчёта из брифа, раздел 8а. */
  readonly code: string;
  readonly title: string;
  /** Вопрос руководителя, на который отвечает отчёт. */
  readonly question: string;
  /** Короткая формулировка для карточки на экране «Отчёты» (одна строка). */
  readonly ask: string;
  readonly description: string;
  readonly endpoint: string;
  /** Чем задаётся период: днями (7/30/90) или датой смены. */
  readonly params: ReportParamKind;
}

/** Отчёты в порядке брифа: сначала смена, затем выводы по периоду. */
export const REPORTS: readonly ReportSpec[] = [
  {
    id: 'report-shift',
    code: 'О1',
    title: 'Сводка смены',
    question: 'Что случилось, пока меня не было?',
    ask: 'Что случилось за смену?',
    description: 'Заявки, аварии и просрочки за день: кто из исполнителей что закрыл и что ждёт проверки.',
    endpoint: '/api/m/report-shift/run',
    params: 'date',
  },
  {
    id: 'report-hotspots',
    code: 'О2',
    title: 'Горячие точки',
    question: 'Что ломается снова и снова и что с этим делать?',
    ask: 'Что ломается снова и снова?',
    description: 'Повторные заявки по технике и кабинетам: где дешевле заменить, чем чинить постоянно.',
    endpoint: '/api/m/report-hotspots/run',
    params: 'days',
  },
  {
    id: 'report-sla',
    code: 'О3',
    title: 'Сроки и SLA',
    question: 'Где мы опаздываем и почему?',
    ask: 'Где мы опаздываем?',
    description: 'Доля закрытых в срок, просроченные заявки, время реакции и решения по подразделениям.',
    endpoint: '/api/m/report-sla/run',
    params: 'days',
  },
  {
    id: 'report-workload',
    code: 'О4',
    title: 'Нагрузка',
    question: 'Кто перегружен, а кто свободен?',
    ask: 'Кто перегружен?',
    description: 'Открытые заявки по инженерам и подразделениям, порог перегруза и среднее время решения.',
    endpoint: '/api/m/report-workload/run',
    params: 'days',
  },
  {
    id: 'report-ai-effect',
    code: 'О5',
    title: 'Эффект ИИ',
    question: 'Окупается ли ИИ?',
    ask: 'Окупается ли ИИ?',
    description:
      'Сколько полей ИИ предложил, сколько диспетчер исправил и сколько времени уходит до подтверждения.',
    endpoint: '/api/m/report-ai-effect/run',
    params: 'days',
  },
  {
    id: 'report-kb-gaps',
    code: 'О6',
    title: 'Пробелы базы знаний',
    question: 'Какие инструкции написать?',
    ask: 'Какие инструкции написать?',
    description: 'Темы обращений, по которым нет статьи, и как часто они повторяются.',
    endpoint: '/api/m/report-kb-gaps/run',
    params: 'days',
  },
  {
    id: 'report-emergency',
    code: 'О7',
    title: 'Аварии',
    question: 'Как мы реагировали на аварии?',
    ask: 'Как реагировали на аварии?',
    description: 'Аварийные заявки, повторные точки, ложные тревоги и время реакции.',
    endpoint: '/api/m/report-emergency/run',
    params: 'days',
  },
];

/** «Вау»-отчёт экрана: О2 «Горячие точки» показываем крупно, остальные — карточками. */
export const HERO_REPORT_ID = 'report-hotspots';

/** Карточки-вопросы под главным отчётом: О1, О3–О7 (без О2). */
export const CARD_REPORTS: readonly ReportSpec[] = REPORTS.filter((report) => report.id !== HERO_REPORT_ID);

export interface ReportRowView {
  key: string;
  cells: string[];
}

export interface ReportTableView {
  columns: string[];
  rows: ReportRowView[];
}

export interface ReportFactView {
  label: string;
  value: string;
}

export interface ReportInsightView {
  meaning: string | null;
  actions: string[];
  source: 'ai' | 'template' | null;
  model: string | null;
}

export function findReport(id: string): ReportSpec | undefined {
  return REPORTS.find((report) => report.id === id);
}

/** Тело `POST /run`: у О1 — дата смены, у остальных — период в днях. */
export function runBody(spec: ReportSpec, days: number, date: string): Record<string, number | string> {
  return spec.params === 'date' ? { date } : { days };
}

/** Ссылка на CSV за тот же период: открывается в новой вкладке. */
export function csvUrl(id: string, days: number, date?: string): string {
  const params = new URLSearchParams({ format: 'csv' });
  if (findReport(id)?.params === 'date') {
    if (date !== undefined && date !== '') params.set('date', date);
  } else {
    params.set('days', String(days));
  }
  return `/api/m/${id}/export?${params.toString()}`;
}

/** Сегодняшний день по местным часам — значение по умолчанию для О1. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `2026-11-14` → `14.11.2026` — дата смены для подписи результата. */
export function formatShiftDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';
  const [, year = '', month = '', day = ''] = match;
  return `${day}.${month}.${year}`;
}

/** Пробел-разделитель разрядов: неразрывный, чтобы «1 284» не рвалось на две строки. */
const THIN_SPACE = '\u00A0';

/** Значение показателя: числа с разрядами, проценты и строки — как есть. */
export function formatMetric(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const sign = value < 0 ? '−' : '';
    const absolute = Math.abs(value);
    const text = Number.isInteger(absolute)
      ? String(absolute)
      : String(Math.round(absolute * 10) / 10).replace('.', ',');
    const [whole = '0', fraction] = text.split(',');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
    return `${sign}${grouped}${fraction === undefined ? '' : `,${fraction}`}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? '—' : trimmed;
  }
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return '—';
}

function formatMinutes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.round(value)} мин`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function formatPercent(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `${formatMetric(value)}%`;
  return formatMetric(value);
}

function formatDateShort(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '—';
  const [, , month = '', day = ''] = match;
  return `${day}.${month}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Внутренний отчёт: ответ `run` оборачивает его в `{ report, facts, insight }`. */
function reportOf(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const inner = asRecord(root['report']);
  return inner ?? root;
}

function rowKey(record: Record<string, unknown>, prefix: string, index: number): string {
  const base =
    asText(record['key']) ??
    asText(record['id']) ??
    asText(record['name']) ??
    asText(record['label']) ??
    asText(record['fieldKey']) ??
    String(index);
  return `${prefix}:${base}:${index}`;
}

function shiftTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['byAssignee']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'assignee', index),
        cells: [
          asText(record['name']) ?? 'Не назначено',
          formatMetric(record['total']),
          formatMetric(record['open']),
          formatMetric(record['closed']),
          formatMinutes(record['avgResolutionMinutes']),
        ],
      },
    ];
  });
  return {
    columns: ['Исполнитель', 'Всего', 'Открыто', 'Закрыто', 'Среднее решение'],
    rows,
  };
}

function hotspotsTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['rows']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'hotspot', index),
        cells: [
          asText(record['label']) ?? '—',
          asText(record['building']) ?? '—',
          formatMetric(record['count']),
          formatPercent(record['sharePercent']),
          formatMinutes(record['avgResolutionMinutes']),
        ],
      },
    ];
  });
  return {
    columns: ['Точка', 'Корпус', 'Заявок', 'Доля', 'Среднее решение'],
    rows,
  };
}

function slaTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['byDepartment']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'department', index),
        cells: [
          asText(record['label']) ?? '—',
          formatMetric(record['total']),
          formatMetric(record['breaches']),
          formatPercent(record['onTimePercent']),
          formatMinutes(record['avgResolutionMinutes']),
        ],
      },
    ];
  });
  return {
    columns: ['Подразделение', 'Всего', 'Нарушений', 'В срок', 'Среднее решение'],
    rows,
  };
}

function workloadTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['byEngineer']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'engineer', index),
        cells: [
          asText(record['name']) ?? 'Не назначено',
          asText(record['departmentLabel']) ?? '—',
          formatMetric(record['open']),
          formatMetric(record['closed']),
          formatMinutes(record['avgResolutionMinutes']),
        ],
      },
    ];
  });
  return {
    columns: ['Инженер', 'Подразделение', 'Открыто', 'Закрыто', 'Среднее решение'],
    rows,
  };
}

function aiEffectTable(report: Record<string, unknown>): ReportTableView {
  const totals = asRecord(report['totals']);
  const rows = asList(totals?.['correctionsByField']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'field', index),
        cells: [
          asText(record['label']) ?? asText(record['fieldKey']) ?? '—',
          formatMetric(record['suggestions']),
          formatMetric(record['corrections']),
        ],
      },
    ];
  });
  return { columns: ['Поле', 'Подсказок', 'Исправлений'], rows };
}

function kbGapsTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['themes']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        key: rowKey(record, 'theme', index),
        cells: [
          asText(record['label']) ?? '—',
          asText(record['categoryLabel']) ?? '—',
          formatMetric(record['count']),
          formatPercent(record['sharePercent']),
          asText(record['exampleNumber']) ?? '—',
        ],
      },
    ];
  });
  return {
    columns: ['Тема', 'Категория', 'Заявок', 'Доля', 'Пример'],
    rows,
  };
}

const EMERGENCY_KIND: Readonly<Record<string, string>> = {
  equipment: 'техника',
  location: 'место',
};

function emergencyTable(report: Record<string, unknown>): ReportTableView {
  const rows = asList(report['hotspots']).flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const kind = asText(record['kind']);
    return [
      {
        key: rowKey(record, 'emergency', index),
        cells: [
          asText(record['label']) ?? '—',
          kind === null ? '—' : (EMERGENCY_KIND[kind] ?? kind),
          formatMetric(record['count']),
          formatPercent(record['sharePercent']),
          formatDateShort(record['lastAt']),
        ],
      },
    ];
  });
  return {
    columns: ['Место', 'Тип', 'Аварий', 'Доля', 'Последняя'],
    rows,
  };
}

/** Таблица отчёта по форме ответа; `null` — формат незнакомый. */
export function reportTable(payload: unknown): ReportTableView | null {
  const report = reportOf(payload);
  if (!report) return null;
  if (Array.isArray(report['byAssignee']) && asRecord(report['totals']) !== null) {
    return shiftTable(report);
  }
  if (Array.isArray(report['rows'])) return hotspotsTable(report);
  if (Array.isArray(report['byEngineer'])) return workloadTable(report);
  const summary = asRecord(report['summary']);
  if (Array.isArray(report['byDepartment']) && summary !== null && 'slaOnTimePercent' in summary) {
    return slaTable(report);
  }
  if (asRecord(report['totals']) !== null && 'period' in report) return aiEffectTable(report);
  if (Array.isArray(report['themes'])) return kbGapsTable(report);
  if (Array.isArray(report['hotspots'])) return emergencyTable(report);
  return null;
}

/** Сколько строк в основной таблице отчёта (до обрезки до 10 на экране). */
export function numberRows(payload: unknown): number {
  return reportTable(payload)?.rows.length ?? 0;
}

/** Показатели `facts` сервера; период уже показан рядом с кнопкой, его пропускаем. */
export function reportFacts(payload: unknown): ReportFactView[] {
  const root = asRecord(payload);
  const raw = root?.['facts'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const label = asText(record['label']);
    // «Точка 1: заявок» дублирует таблицу отчёта — на экране оставляем только итоги.
    if (label === null || /^период/i.test(label) || /^точка\s+\d/i.test(label)) return [];
    return [{ label, value: formatMetric(record['value']) }];
  });
}

function textList(value: unknown): string[] {
  return asList(value).flatMap((item) => {
    const text = asText(item);
    return text === null ? [] : [text];
  });
}

/** «Что это значит» / «Что сделать» из ответа; поддерживает `insight` и `insights`. */
export function insightView(payload: unknown): ReportInsightView {
  const root = asRecord(payload);
  const empty: ReportInsightView = { meaning: null, actions: [], source: null, model: null };
  if (!root) return empty;

  let meaning: string | null = null;
  let actions: string[] = [];
  let source: 'ai' | 'template' | null = null;
  let model: string | null = null;

  const node = root['insight'];
  if (typeof node === 'string') {
    meaning = asText(node);
  } else {
    const record = asRecord(node);
    if (record) {
      meaning = asText(record['meaning']) ?? asText(record['text']) ?? asText(record['insight']);
      actions = textList(record['actions']);
      const rawSource = asText(record['source']);
      source = rawSource === 'ai' || rawSource === 'template' ? rawSource : null;
      model = asText(record['model']);
    }
  }

  const insights = root['insights'];
  if (Array.isArray(insights)) {
    const texts = insights.flatMap((item) => {
      if (typeof item === 'string') {
        const text = asText(item);
        return text === null ? [] : [text];
      }
      const record = asRecord(item);
      const text = asText(record?.['text']) ?? asText(record?.['meaning']) ?? asText(record?.['action']);
      return text === null ? [] : [text];
    });
    if (meaning === null && texts.length > 0) meaning = texts[0] ?? null;
    if (actions.length === 0) actions = texts.length > 1 ? texts.slice(1) : [];
  }

  if (meaning === null) meaning = asText(root['meaning']);
  if (actions.length === 0) actions = textList(root['actions']);

  return { meaning, actions, source, model };
}

/** Только текст «что это значит» — для компактного блока. */
export function insightText(payload: unknown): string | null {
  return insightView(payload).meaning;
}

/** Только рекомендации «что сделать». */
export function insightActions(payload: unknown): string[] {
  return insightView(payload).actions;
}

/** Ответ — ошибка (`{ error }`, `{ ok: false }`) даже при HTTP 200. */
export function isReportError(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  if (record['ok'] === false) return true;
  if (typeof record['error'] === 'string' && record['error'].trim() !== '') return true;
  return asRecord(record['error']) !== null;
}

/** Текст ошибки из ответа сервера. */
export function errorMessage(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  const direct = asText(record['error']) ?? asText(record['message']);
  if (direct !== null) return direct;
  const error = asRecord(record['error']);
  return asText(error?.['message']) ?? asText(error?.['error']) ?? null;
}

/** Ответ похож на отчёт: есть `report`, `facts` или знакомая таблица. */
export function isKnownReportPayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  if (asRecord(record['report']) !== null) return true;
  if (Array.isArray(record['facts'])) return true;
  return reportTable(payload) !== null;
}

/** Пусто: ни строк в таблице, ни показателей — за период нечего показывать. */
export function reportIsEmpty(payload: unknown): boolean {
  return numberRows(payload) === 0 && reportFacts(payload).length === 0;
}

/* ---------- Карточки-ответы на экране «Отчёты» ---------- */

/**
 * Короткий ответ отчёта без модели: карточка показывает одну цифру.
 * `GET /api/m/<id>/?…` считает цифры кодом (без вызова ИИ), поэтому хаб грузит
 * все ответы сразу. Вывод ИИ («что это значит») остаётся в самом отчёте.
 */
export function summaryUrl(spec: ReportSpec, days: number, date: string): string {
  const params = new URLSearchParams();
  if (spec.params === 'date') params.set('date', date);
  else params.set('days', String(days));
  // Маршрут модуля зарегистрирован как `/` — без косой черты Fastify вернёт 404.
  return `/api/m/${spec.id}/?${params.toString()}`;
}

/** Единица измерения ответа: проценты, минуты, штуки или текст (имя, место, тема). */
export type AnswerUnit = 'percent' | 'minutes' | 'count' | 'text';

export interface ReportAnswer {
  /** Число — анимируется счётчиком; строка — место, имя или тема. */
  readonly value: number | string;
  readonly unit: AnswerUnit;
  /** Короткая подпись к цифре: «закрыто в срок», «заявок без правки». */
  readonly caption: string;
  /** Вторая строка при наличии данных; `null` — не показываем. */
  readonly hint: string | null;
}

/** Русское склонение: `plural(23, 'заявка', 'заявки', 'заявок')` → «заявки». */
export function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(Math.trunc(count));
  const tail100 = absolute % 100;
  const tail10 = absolute % 10;
  if (tail100 >= 11 && tail100 <= 14) return many;
  if (tail10 === 1) return one;
  if (tail10 >= 2 && tail10 <= 4) return few;
  return many;
}

/** Значение ответа без анимации: «48,2%», «19 мин», «1 284», «Кузнецов». */
export function formatAnswer(answer: ReportAnswer): string {
  if (typeof answer.value === 'string') return answer.value;
  const text = formatMetric(answer.value);
  if (answer.unit === 'percent') return `${text}%`;
  if (answer.unit === 'minutes') return `${text} мин`;
  return text;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return asList(value).flatMap((item) => {
    const record = asRecord(item);
    return record === null ? [] : [record];
  });
}

/** Последнее слово имени: «Артём Кузнецов» → «Кузнецов». */
function surname(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  return words[words.length - 1] ?? name.trim();
}

/** Длинная тема не должна разваливать карточку: обрезаем по границе слова. */
function shortLabel(text: string, limit = 26): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  const base = (space > 12 ? cut.slice(0, space) : cut).replace(/[\s,;:.·—-]+$/, '');
  return `${base}…`;
}

function minutesText(value: number | null): string | null {
  if (value === null) return null;
  if (value < 60) return `${Math.round(value)} мин`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** О1: сколько заявок пришло за смену и сколько из них аварий. */
function shiftAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const totals = asRecord(report['totals']);
  const created = num(totals?.['created']);
  if (created === null) return null;
  const emergency = num(totals?.['emergency']) ?? 0;
  return {
    value: created,
    unit: 'count',
    caption: `${plural(created, 'заявка', 'заявки', 'заявок')} за смену`,
    hint: emergency === 0 ? 'без аварий' : `${emergency} ${plural(emergency, 'авария', 'аварии', 'аварий')}`,
  };
}

/** О3: доля закрытых в срок и сколько заявок уже вне срока. */
function slaAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const summary = asRecord(report['summary']);
  const percent = num(summary?.['slaOnTimePercent']);
  if (percent === null) return null;
  const overdue = num(summary?.['openOverdue']) ?? 0;
  const atRisk = num(summary?.['atRisk']) ?? 0;
  const parts = [
    overdue > 0 ? `${overdue} просрочено` : null,
    atRisk > 0 ? `${atRisk} под риском` : null,
  ].filter((part): part is string => part !== null);
  return {
    value: percent,
    unit: 'percent',
    caption: 'закрыто в срок',
    hint: parts.length === 0 ? 'сроки не нарушены' : parts.join(' · '),
  };
}

/** О4: перегружен ли кто-то; если нет — честно говорим «никто» и показываем лидера. */
function workloadAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const summary = asRecord(report['summary']);
  const threshold = num(summary?.['overloadThreshold']);
  const overloaded = num(summary?.['overloaded']) ?? 0;
  const engineers = records(report['byEngineer'])
    .filter((row) => asText(row['name']) !== null && row['assigneeId'] !== null)
    .sort((left, right) => (num(right['open']) ?? 0) - (num(left['open']) ?? 0));
  const top = engineers[0];
  const topName = top === undefined ? null : asText(top['name']);
  const topOpen = top === undefined ? null : num(top['open']);

  if (overloaded > 0) {
    const busy = engineers.find((row) => row['overload'] === true) ?? top;
    const name = busy === undefined ? null : asText(busy['name']);
    const open = busy === undefined ? null : num(busy['open']);
    if (name === null || open === null) return null;
    return {
      value: surname(name),
      unit: 'text',
      caption:
        threshold === null
          ? `${open} ${plural(open, 'открытая заявка', 'открытые заявки', 'открытых заявок')}`
          : `${open} из ${threshold} задач`,
      hint: `${overloaded} ${plural(overloaded, 'инженер перегружен', 'инженера перегружены', 'инженеров перегружены')}`,
    };
  }

  if (topName === null || topOpen === null || topOpen === 0) return null;
  return {
    value: 'Никто',
    unit: 'text',
    caption: 'перегруженных инженеров нет',
    hint: `больше всех — ${surname(topName)}, ${topOpen} ${plural(topOpen, 'задача', 'задачи', 'задач')}`,
  };
}

/** О5: какая доля заявок оформлена ИИ без правок диспетчера. */
function aiEffectAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const totals = asRecord(report['totals']);
  const share = num(totals?.['shareWithoutEditsPercent']);
  if (share === null) return null;
  const confirm = minutesText(num(totals?.['avgMinutesToConfirm']));
  return {
    value: share,
    unit: 'percent',
    caption: 'заявок ИИ оформил без правок',
    hint: confirm === null ? null : `${confirm} до подтверждения`,
  };
}

/** О6: тема, по которой чаще всего нет статьи. */
function kbGapsAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const theme = records(report['themes'])[0];
  if (theme === undefined) return null;
  const label = asText(theme['label']);
  const count = num(theme['count']);
  if (label === null || count === null) return null;
  return {
    value: shortLabel(label),
    unit: 'text',
    caption: `${count} ${plural(count, 'заявка', 'заявки', 'заявок')} без статьи`,
    hint: null,
  };
}

/** О7: средняя реакция на аварию; если реакций не мерили — число аварий. */
function emergencyAnswer(report: Record<string, unknown>): ReportAnswer | null {
  const summary = asRecord(report['summary']);
  if (summary === null) return null;
  const reaction = num(summary['avgReactionMinutes']);
  const emergency = num(summary['emergency']) ?? 0;
  const hint = `${emergency} ${plural(emergency, 'авария', 'аварии', 'аварий')} за период`;
  if (reaction !== null && reaction > 0) {
    return { value: reaction, unit: 'minutes', caption: 'средняя реакция на аварию', hint };
  }
  if (emergency > 0) {
    return { value: emergency, unit: 'count', caption: 'аварий за период', hint: null };
  }
  return null;
}

const ANSWERS: Readonly<Record<string, (report: Record<string, unknown>) => ReportAnswer | null>> = {
  'report-shift': shiftAnswer,
  'report-sla': slaAnswer,
  'report-workload': workloadAnswer,
  'report-ai-effect': aiEffectAnswer,
  'report-kb-gaps': kbGapsAnswer,
  'report-emergency': emergencyAnswer,
};

/** Короткий ответ карточки; `null` — данных нет, показываем честное пустое состояние. */
export function summaryAnswer(id: string, payload: unknown): ReportAnswer | null {
  const report = reportOf(payload);
  if (report === null) return null;
  const reader = ANSWERS[id];
  if (reader === undefined) return null;
  try {
    return reader(report);
  } catch {
    return null;
  }
}

/* ---------- Главный отчёт О2 «Что ломается снова» ---------- */

export interface HotspotBarView {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Ширина полоски от максимума, %: 100 у самой горячей точки. */
  readonly width: number;
}

export interface HotspotFocusView {
  readonly label: string;
  readonly count: number;
  /** «6 заявок за 30 дней» — короткая причина без пояснений. */
  readonly caption: string;
  /** Сравнение с прошлым периодом одной строкой; `null` — сравнить не с чем. */
  readonly trend: string | null;
  readonly bars: HotspotBarView[];
  /** Заявок в точках, где поломка повторилась. */
  readonly repeated: number;
}

function trendText(trend: number | null): string | null {
  if (trend === null) return null;
  if (trend === 0) return 'столько же, сколько в прошлом периоде';
  const sign = trend > 0 ? '+' : '−';
  return `${sign}${formatMetric(Math.abs(trend))}% к прошлому периоду`;
}

/** Четыре самые горячие точки: подпись, число и полоска для главной карточки О2. */
export function hotspotFocus(payload: unknown): HotspotFocusView | null {
  const report = reportOf(payload);
  if (report === null) return null;
  const rows = records(report['rows'])
    .filter((row) => (num(row['count']) ?? 0) >= 2)
    .sort((left, right) => (num(right['count']) ?? 0) - (num(left['count']) ?? 0));
  const top = rows[0];
  if (top === undefined) return null;
  const label = asText(top['label']);
  const count = num(top['count']);
  if (label === null || count === null) return null;
  const max = num(rows[0]?.['count']) ?? count;
  const days = num(asRecord(report['period'])?.['days']) ?? null;
  const bars = rows.slice(0, 4).map((row, index) => {
    const barLabel = asText(row['label']) ?? '—';
    const barCount = num(row['count']) ?? 0;
    return {
      key: asText(row['key']) ?? `bar-${index}`,
      label: shortLabel(barLabel, 22),
      count: barCount,
      width: max === 0 ? 0 : Math.round((barCount / max) * 100),
    };
  });
  return {
    label,
    count,
    caption:
      days === null
        ? `${count} ${plural(count, 'заявка', 'заявки', 'заявок')}`
        : `${count} ${plural(count, 'заявка', 'заявки', 'заявок')} за ${days} ${plural(days, 'день', 'дня', 'дней')}`,
    trend: trendText(num(top['trendPercent'])),
    bars,
    repeated: num(report['repeatedTickets']) ?? 0,
  };
}
