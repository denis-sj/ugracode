import type { MetaResponse, PriorityLevel, Ticket, TicketField, TicketStatus } from '@ugra/contracts';

/**
 * Чистые функции рабочего места инженера (4.6): мои задачи, сроки регламента,
 * поля оборудования, подбор статьи базы знаний, частые поломки, быстрые формулировки.
 * Всё, что требует DOM или сети, живёт в `EngineerDeskPage.tsx`.
 */

/* ---------- Данные маршрута базы знаний ---------- */

/** Статистика статьи: сколько раз решение помогло. Поля в API пока нет — читаем, если придёт. */
export interface ArticleStats {
  helped: number;
  total: number;
}

/** Статья, как её отдаёт `GET /api/m/knowledge/search` (см. модуль `knowledge`). */
export interface KnowledgeArticle {
  id: string;
  title: string;
  symptoms: string[];
  steps: string[];
  solution: string;
  category: string | null;
  score?: number;
  stats?: ArticleStats;
}

/** Похожая решённая заявка из того же ответа; длительности в API нет — не выдумываем. */
export interface SimilarTicket {
  ticketId: string;
  number: string;
  status: string;
  title: string;
  score: number;
}

export interface KnowledgeResponse {
  articles: KnowledgeArticle[];
  tickets: SimilarTicket[];
}

/** Отметка шага статьи у заявки: `GET /api/m/knowledge/tickets/:id/steps`. */
export interface ArticleStep {
  ticketId: string;
  articleId: string;
  stepIndex: number;
  done: boolean;
  updatedAt: string;
}

export interface ArticleStepsResponse {
  ticketId: string;
  steps: ArticleStep[];
}

/* ---------- Статусы и действия ---------- */

/** Действие инженера на карточке задачи. */
export type EngineerAction = 'take' | 'resolve' | 'extend' | 'return';

const ACTION_BY_STATUS: Record<string, readonly EngineerAction[]> = {
  assigned: ['take', 'return'],
  in_progress: ['resolve', 'extend', 'return'],
};

/**
 * Что инженер может сделать в этом статусе. Таблица переходов ядра:
 * `assigned → in_progress`, `in_progress → resolved`, `assigned|in_progress → in_review`.
 * В остальных статусах карточка только для чтения.
 */
export function statusActions(status: TicketStatus): EngineerAction[] {
  return [...(ACTION_BY_STATUS[status] ?? [])];
}

/** Действие доступно — подписи кнопок и подсказки в одном месте. */
export const ACTION_LABELS: Record<EngineerAction, string> = {
  take: 'Взять в работу',
  resolve: 'Выполнено',
  extend: 'Продлить срок',
  return: 'Вернуть диспетчеру',
};

const STATUSES: ReadonlySet<string> = new Set<TicketStatus>([
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
]);

/** Статус из строки похожей заявки → известный статус ядра, иначе `null`. */
export function asTicketStatus(value: string): TicketStatus | null {
  return STATUSES.has(value) ? (value as TicketStatus) : null;
}

/* ---------- Мои задачи ---------- */

function priorityRank(ticket: Pick<Ticket, 'priority' | 'isEmergency'>): number {
  if (ticket.isEmergency) return 0;
  const order: Record<PriorityLevel, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
  return ticket.priority === null ? 5 : order[ticket.priority];
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** Ближайший срок регламента: реакция или решение. Без срока — в конец списка. */
export function nearestDue(ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>): number {
  const times = [timeOf(ticket.reactDueAt), timeOf(ticket.slaDueAt)].filter(
    (value): value is number => value !== null,
  );
  return times.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...times);
}

/** Дата ближайшего срока — её и показываем в списке задач. */
export function nearestDueAt(ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>): string | null {
  const candidates = [
    { iso: ticket.reactDueAt, time: timeOf(ticket.reactDueAt) },
    { iso: ticket.slaDueAt, time: timeOf(ticket.slaDueAt) },
  ].filter((entry): entry is { iso: string; time: number } => entry.iso !== null && entry.iso !== undefined && entry.time !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, entry) => (entry.time < best.time ? entry : best)).iso;
}

/** Задачи «на сегодня»: назначены мне и ещё не выполнены. */
export function myTasks(tickets: readonly Ticket[], userId: string): Ticket[] {
  return tickets.filter(
    (ticket) =>
      ticket.assigneeId === userId && (ticket.status === 'assigned' || ticket.status === 'in_progress'),
  );
}

/** Сортировка задач: ближайший срок, затем приоритет, затем номер. Исходный массив не меняется. */
export function sortMyTasks(tickets: readonly Ticket[]): Ticket[] {
  return [...tickets].sort((left, right) => {
    const leftDue = nearestDue(left);
    const rightDue = nearestDue(right);
    if (leftDue !== rightDue) {
      if (leftDue === Number.POSITIVE_INFINITY) return 1;
      if (rightDue === Number.POSITIVE_INFINITY) return -1;
      return leftDue - rightDue;
    }
    const byPriority = priorityRank(left) - priorityRank(right);
    if (byPriority !== 0) return byPriority;
    return left.number.localeCompare(right.number);
  });
}

/* ---------- Сроки ---------- */

export type DueTone = 'neutral' | 'warn' | 'danger';

export interface DueState {
  /** «осталось 3 ч 26 мин» или «просрочено 12 мин». */
  text: string;
  tone: DueTone;
  overdue: boolean;
  dueAt: string;
}

const WARN_BEFORE_MS = 15 * 60_000;

/** Человеческая длительность: «< 1 мин», «12 мин», «2 ч 5 мин», «3 д 4 ч». */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.abs(ms);
  if (total < 60_000) return '< 1 мин';
  const totalMinutes = Math.floor(total / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  return `${minutes} мин`;
}

/** Сколько осталось до срока. Нет даты или она битая — срока нет, а не «NaN мин». */
export function dueState(dueAt: string | null | undefined, now: number): DueState | null {
  const time = timeOf(dueAt);
  if (time === null || !dueAt) return null;
  const left = time - now;
  const overdue = left < 0;
  const tone: DueTone = overdue ? 'danger' : left <= WARN_BEFORE_MS ? 'warn' : 'neutral';
  return {
    text: overdue ? `просрочено ${formatRemaining(left)}` : `осталось ${formatRemaining(left)}`,
    tone,
    overdue,
    dueAt,
  };
}

/**
 * Короткая подпись срока для узкой строки списка: «2 ч», «3 д», «просрочено».
 * Полная подпись — `dueState().text`, она живёт на карточке задачи.
 */
export function shortDueLabel(dueAt: string | null | undefined, now: number): string {
  const time = timeOf(dueAt);
  if (time === null) return 'без срока';
  const left = time - now;
  return left < 0 ? 'просрочено' : formatRemaining(left);
}

/* ---------- Поля заявки ---------- */

/** Значение поля заявки строкой; пустое и `null` — `null`. */
export function fieldValue(fields: readonly TicketField[] | null | undefined, key: string): string | null {
  const field = fields?.find((entry) => entry.fieldKey === key);
  if (!field || field.value === null || `${field.value}`.trim() === '') return null;
  return String(field.value);
}

function dictionaryLabel(meta: MetaResponse | null, dictionary: string, code: string | null): string | null {
  if (!code) return null;
  if (!meta) return code;
  const item = meta.dictionaries.find((entry) => entry.dictionary === dictionary && entry.code === code);
  return item?.label ?? code;
}

/** Оборудование и место из полей заявки — для шапки задачи и поиска по базе знаний. */
export interface TaskEquipment {
  object: string | null;
  equipment: string | null;
  model: string | null;
  errorCode: string | null;
  symptoms: string | null;
  building: string | null;
  cabinet: string | null;
}

export function taskEquipment(fields: readonly TicketField[] | null | undefined): TaskEquipment {
  return {
    object: fieldValue(fields, 'object'),
    equipment: fieldValue(fields, 'equipment'),
    model: fieldValue(fields, 'model'),
    errorCode: fieldValue(fields, 'errorCode'),
    symptoms: fieldValue(fields, 'symptoms'),
    building: fieldValue(fields, 'building'),
    cabinet: fieldValue(fields, 'cabinet'),
  };
}

/** Название задачи: симптомы словами заявителя, иначе объект, иначе категория. */
export function taskTitle(
  meta: MetaResponse | null,
  ticket: Pick<Ticket, 'category'>,
  fields: readonly TicketField[] | null | undefined,
): string {
  const symptoms = fieldValue(fields, 'symptoms');
  if (symptoms) return symptoms;
  const object = fieldValue(fields, 'object');
  if (object) return `Не работает: ${object}`;
  return dictionaryLabel(meta, 'category', ticket.category) ?? 'Обращение';
}

/** «Корп. Б, каб. 312» — пустые части не рисуем. */
export function taskPlace(
  meta: MetaResponse | null,
  fields: readonly TicketField[] | null | undefined,
): string {
  const { building, cabinet } = taskEquipment(fields);
  const buildingLabel = dictionaryLabel(meta, 'building', building);
  const parts: string[] = [];
  if (buildingLabel) {
    const lower = buildingLabel.toLowerCase();
    parts.push(lower.startsWith('корпус') || lower.startsWith('пром') ? buildingLabel : `Корп. ${buildingLabel}`);
  }
  if (cabinet) parts.push(`каб. ${cabinet}`);
  return parts.join(', ');
}

/** Оборудование одной строкой: «HP LaserJet M428 · инв. 00417». */
export function equipmentLine(fields: readonly TicketField[] | null | undefined): string {
  const { errorCode } = taskEquipment(fields);
  const inventory = fieldValue(fields, 'inventoryNo');
  return [equipmentName(fields), inventory ? `инв. ${inventory}` : '', errorCode ? `ошибка ${errorCode}` : '']
    .filter((value) => value !== '')
    .join(' · ');
}

/**
 * Название техники без повторов: в заявке модель часто записана и в `equipment`, и в `model`
 * («HP LaserJet Pro M404dn» дважды) — на экран она попадает один раз.
 */
export function equipmentName(fields: readonly TicketField[] | null | undefined): string {
  const { equipment, model } = taskEquipment(fields);
  return [...new Set([equipment, model].filter((value): value is string => Boolean(value)))].join(' ');
}

/**
 * Запрос в базу знаний: симптомы + объект + оборудование + модель + код ошибки.
 * Пустые поля не попадают; длинные значения обрезаются, чтобы URL оставался разумным.
 */
export function knowledgeQuery(
  fields: readonly TicketField[] | null | undefined,
  category: string | null = null,
): string {
  const { symptoms, object, equipment, model, errorCode } = taskEquipment(fields);
  const parts = [symptoms, object, equipment, model, errorCode, category].filter(
    (value): value is string => Boolean(value && value.trim() !== ''),
  );
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

/* ---------- Подбор статьи ---------- */

const STOP_WORDS: ReadonlySet<string> = new Set([
  'без',
  'был',
  'была',
  'были',
  'все',
  'где',
  'для',
  'его',
  'если',
  'есть',
  'ещё',
  'как',
  'когда',
  'она',
  'они',
  'при',
  'так',
  'уже',
  'что',
  'эти',
  'это',
]);

/** Слова для сравнения: без регистра и знаков, короче трёх букв и служебные — мимо. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function sameStem(word: string, candidate: string): boolean {
  const length = Math.min(word.length, candidate.length, 5);
  return length >= 3 && word.slice(0, length) === candidate.slice(0, length);
}

/** Сколько слов запроса нашлось в тексте (совпадение по началу слова). */
export function matchScore(words: readonly string[], text: string): number {
  if (words.length === 0) return 0;
  const target = normalizeWords(text);
  if (target.length === 0) return 0;
  let score = 0;
  for (const word of words) {
    if (target.some((candidate) => sameStem(word, candidate))) score += 1;
  }
  return score;
}

function articleText(article: KnowledgeArticle): string {
  return [article.title, ...article.symptoms, ...article.steps, article.solution].join(' ');
}

/**
 * Статья, которая лучше всего совпала с запросом. Пустой список — `null`;
 * при нулевом совпадении берём первую: сервер уже отфильтровал выдачу.
 */
export function pickArticle(
  articles: readonly KnowledgeArticle[],
  query: string,
): KnowledgeArticle | null {
  if (articles.length === 0) return null;
  const words = normalizeWords(query);
  let best: KnowledgeArticle | null = null;
  let bestScore = -1;
  for (const article of articles) {
    const score = matchScore(words, articleText(article)) + (article.score ?? 0) / 100;
    if (score > bestScore) {
      best = article;
      bestScore = score;
    }
  }
  return best;
}

/* ---------- Частая поломка оборудования ---------- */

/** Общие слова устройств: сами по себе не доказывают, что поломка та же. */
const GENERIC_EQUIPMENT: ReadonlySet<string> = new Set([
  'принтер',
  'принтера',
  'принтере',
  'мфу',
  'компьютер',
  'компьютера',
  'монитор',
  'монитора',
  'ноутбук',
  'ноутбука',
  'клавиатура',
  'мышь',
  'кабель',
  'кабеля',
  'сеть',
  'сети',
  'картридж',
  'бумага',
  'бумаги',
]);

function equipmentTokens(equipment: string): string[] {
  return normalizeWords(equipment).filter(
    (word) => !GENERIC_EQUIPMENT.has(word) && (/\d/.test(word) || word.length >= 4),
  );
}

/** Заявка про то же оборудование: в её описании есть модель/инвентарный признак. */
export function matchesEquipment(title: string, equipment: string): boolean {
  const tokens = equipmentTokens(equipment);
  if (tokens.length === 0) return false;
  const words = normalizeWords(title);
  return tokens.some((token) => words.some((word) => sameStem(token, word)));
}

/**
 * Сколько заявок в выдаче относятся к тому же оборудованию.
 * Возвращаем число, чтобы интерфейс показал предупреждение только при `> 1`.
 */
export function recurringEquipmentCount(tickets: readonly SimilarTicket[], equipment: string): number {
  return tickets.filter((ticket) => matchesEquipment(ticket.title, equipment)).length;
}

/* ---------- Результат работы ---------- */

const QUICK_OUTCOMES: Record<string, readonly string[]> = {
  printer: ['Заменён картридж', 'Удалён застрявший лист', 'Почищен ролик подачи'],
  pc: ['Перезапущен компьютер', 'Заменён кабель', 'Обновлён драйвер'],
  network: ['Перезапущен коммутатор', 'Заменён патч-корд', 'Настроено подключение'],
  software: ['Переустановлена программа', 'Сброшен пароль', 'Установлено обновление'],
  server: ['Перезапущена служба', 'Освобождено место на диске', 'Проверены журналы'],
  peripheral: ['Заменено устройство', 'Переподключён кабель', 'Установлен драйвер'],
};

/** Быстрые формулировки «что сделано» по категории. Нет категории — нет подсказок. */
export function quickOutcomes(category: string | null): string[] {
  if (!category) return [];
  return [...(QUICK_OUTCOMES[category] ?? [])];
}

const SENTENCE_END = /[.!?]$/;

/** Дописывает формулировку к результату: точка, пробел, без дублей. */
export function appendOutcome(text: string, outcome: string): string {
  const addition = outcome.trim();
  if (addition === '') return text;
  const base = text.trim();
  if (base === '') return addition;
  if (base.toLowerCase().includes(addition.toLowerCase())) return text;
  const separator = SENTENCE_END.test(base) ? ' ' : '. ';
  return `${base}${separator}${addition}`;
}

/* ---------- Диалоги ---------- */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Значение для `<input type="datetime-local">`: через `hours` часов от `now`, локальное время. */
export function defaultDeadlineInput(now: number, hours = 2): string {
  const date = new Date(now + hours * 3_600_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Локальное значение `datetime-local` → ISO для API. Пустое или битое — `null`. */
export function deadlineInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const time = new Date(trimmed).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Причина обязательна: минимум три символа, иначе кнопка неактивна. */
export function reasonReady(reason: string, minLength = 3): boolean {
  return reason.trim().length >= minLength;
}

/** Прогресс чек-листа: сколько шагов отмечено из скольких. */
export function stepProgress(steps: readonly string[], checked: ReadonlySet<number>): {
  done: number;
  total: number;
} {
  const total = steps.length;
  let done = 0;
  for (let index = 0; index < total; index += 1) {
    if (checked.has(index)) done += 1;
  }
  return { done, total };
}

/** Ключ отметки шага в состоянии экрана: статья + номер шага. */
export function stepKey(articleId: string, stepIndex: number): string {
  return `${articleId}:${stepIndex}`;
}

/** Отметки с сервера → плоская карта `article:step`: так их читает чек-лист. */
export function stepsToChecked(steps: readonly ArticleStep[]): Record<string, boolean> {
  const checked: Record<string, boolean> = {};
  for (const step of steps) {
    if (step.done) checked[stepKey(step.articleId, step.stepIndex)] = true;
  }
  return checked;
}

/** Подпись счётчика чек-листа: «выполнено 2 из 5». */
export function stepCounterLabel(done: number, total: number): string {
  return `выполнено ${done} из ${total}`;
}

/** Русское склонение по числу: 1 задача, 2 задачи, 5 задач. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(Math.trunc(Number.isFinite(count) ? count : 0)) % 100;
  const last = absolute % 10;
  if (absolute >= 11 && absolute <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «3 задачи» — подпись списка задач на сегодня. */
export function tasksCountLabel(count: number): string {
  return `${count} ${pluralRu(count, 'задача', 'задачи', 'задач')}`;
}

/* ---------- Заголовки и подписи карточки ---------- */

/** Первая буква заглавная: заголовок из симптомов заявителя приходит строчными. */
export function capitalizeFirst(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return `${trimmed.charAt(0).toLocaleUpperCase('ru')}${trimmed.slice(1)}`;
}

/**
 * Подпись таймера на карточке задачи: «2 ч 14 мин до срока» или «просрочено 12 мин».
 * Срок не задан — так и пишем, без выдуманных чисел.
 */
export function dueBadgeLabel(state: DueState | null): string {
  if (!state) return 'срок не задан';
  if (state.overdue) return state.text;
  return `${state.text.replace(/^осталось\s+/u, '')} до срока`;
}

/* ---------- Диагностика: кандидаты запроса ---------- */

/** Строка непустая и ещё не встречалась: повторы в запрос не попадают. */
function uniqueQueries(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const text = candidate.replace(/\s+/gu, ' ').trim();
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/**
 * Запросы в базу знаний от точного к общему.
 *
 * Сервер ищет по всем словам сразу, поэтому одна редкая деталь («оранжевая лампочка»)
 * обнуляет выдачу. Экран пробует кандидатов по очереди и берёт первый ответ со статьями.
 */
export function knowledgeQueries(
  fields: readonly TicketField[] | null | undefined,
  category: string | null = null,
): string[] {
  const { symptoms, object, equipment, model } = taskEquipment(fields);
  const modelHead = model ? model.split(/\s+/u).slice(0, 2).join(' ') : '';
  const symptomHead = symptoms ? normalizeWords(symptoms).slice(0, 2).join(' ') : '';
  return uniqueQueries([
    knowledgeQuery(fields, category),
    [object, equipment].filter((value): value is string => Boolean(value)).join(' '),
    object ?? '',
    equipment ?? '',
    modelHead,
    symptoms ?? '',
    symptomHead,
  ]);
}

/* ---------- Похожие решённые заявки ---------- */

/** Заявка доведена до конца: «похожие решённые», а не отменённые. */
const SOLVED_STATUSES: ReadonlySet<string> = new Set(['resolved', 'closed']);

/** Только решённые и закрытые заявки — отменённые решением не считаются. */
export function solvedSimilar(tickets: readonly SimilarTicket[]): SimilarTicket[] {
  return tickets.filter((ticket) => SOLVED_STATUSES.has(ticket.status));
}

/** Одна формулировка похожих заявок: сколько раз встречалась и какая заявка последняя. */
export interface SimilarGroup {
  title: string;
  count: number;
  number: string;
}

/**
 * Похожие заявки без простыни: одинаковые формулировки — одна строка со счётчиком.
 * Сначала частые, затем по заголовку, чтобы порядок не «прыгал» между загрузками.
 */
export function groupSimilarTickets(tickets: readonly SimilarTicket[]): SimilarGroup[] {
  const groups = new Map<string, SimilarGroup>();
  for (const ticket of tickets) {
    const title = ticket.title.trim();
    if (title === '') continue;
    const known = groups.get(title);
    if (known) {
      known.count += 1;
      if (ticket.number > known.number) known.number = ticket.number;
      continue;
    }
    groups.set(title, { title, count: 1, number: ticket.number });
  }
  return [...groups.values()].sort(
    (left, right) => right.count - left.count || left.title.localeCompare(right.title, 'ru'),
  );
}

/** Сводка похожих: «4 заявки · 2 формулировки». */
export function similarSummary(groups: readonly SimilarGroup[]): string {
  if (groups.length === 0) return 'похожих решений нет';
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const word = pluralRu(total, 'заявка', 'заявки', 'заявок');
  if (groups.length === 1) return `${total} ${word} с той же формулировкой`;
  return `${total} ${word} · ${groups.length} ${pluralRu(groups.length, 'формулировка', 'формулировки', 'формулировок')}`;
}

/* ---------- Шаги диагностики ---------- */

/** Состояние шага в чек-листе: сделан, текущий (первый неотмеченный) или ещё впереди. */
export type StepState = 'done' | 'now' | 'next';

/** Состояния шагов статьи: отмеченные — `done`, первый неотмеченный — `now`, как в макете. */
export function stepStates(
  steps: readonly string[],
  checked: Readonly<Record<string, boolean>>,
  articleId: string,
): StepState[] {
  let current = -1;
  const states: StepState[] = steps.map((_step, index) => {
    if (checked[stepKey(articleId, index)]) return 'done';
    if (current < 0) current = index;
    return 'next';
  });
  if (current >= 0) states[current] = 'now';
  return states;
}

/** Статистика статьи «помогла N из M раз» — только если API её отдал и числа правдоподобны. */
export interface ArticleHelp {
  helped: number;
  total: number;
  /** Доля 0…1 для кольца. */
  ratio: number;
  /** «помогла 9 из 11 раз». */
  label: string;
}

export function articleHelp(article: KnowledgeArticle | null | undefined): ArticleHelp | null {
  const stats = article?.stats;
  if (!stats) return null;
  const { helped, total } = stats;
  if (!Number.isFinite(helped) || !Number.isFinite(total)) return null;
  if (total <= 0 || helped < 0 || helped > total) return null;
  const roundedHelped = Math.round(helped);
  const roundedTotal = Math.round(total);
  if (roundedTotal <= 0) return null;
  return {
    helped: roundedHelped,
    total: roundedTotal,
    ratio: roundedHelped / roundedTotal,
    label: `помогла ${roundedHelped} из ${roundedTotal} ${pluralRu(roundedTotal, 'раз', 'раза', 'раз')}`,
  };
}
