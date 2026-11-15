import type { MetaResponse, Ticket } from '@ugra/contracts';

/**
 * Чистые функции экрана 13 «База знаний» (инженер).
 * Всё, что требует DOM или сети, живёт в `KnowledgePage.tsx`.
 *
 * Ответ API может быть битым (модуль выключен, старая версия сервера): функции принимают
 * `unknown` и пропускают записи без id/заголовка, а не падают на `undefined.steps`.
 */

/* ---------- Данные маршрутов модуля `knowledge` ---------- */

/** Статья, как её отдаёт `GET /api/m/knowledge/search` и `GET /api/m/knowledge/articles/:id`. */
export interface KnowledgeArticle {
  id: string;
  title: string;
  symptoms: string[];
  steps: string[];
  solution: string;
  category: string | null;
  /** Совпадения слов (`MemoryStore`) или `ts_rank` (`PgStore`): больше — релевантнее. */
  score?: number;
  /**
   * ❓ API пока не отдаёт статистику статьи. Поле читаем, если оно появится,
   * и тогда показываем «помогла N из M»; без него блок статистики не рисуется.
   */
  stats?: ArticleStats;
}

export interface ArticleStats {
  helped: number;
  total: number;
}

/** Похожая решённая заявка из того же ответа. На экране 13 не используется. */
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

/** Ссылка на статью в ответе агента `engineer-assistant`. */
export interface AskSource {
  id: string;
  title: string;
}

/** Ответ `POST /api/m/knowledge/ask`: только по найденным статьям. */
export interface AskResponse {
  answer: string;
  sources: AskSource[];
  steps?: string[];
  mode: 'agent' | 'template';
}

/* ---------- Разбор ответа ---------- */

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = textValue(item);
    if (text !== '') result.push(text);
  }
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStats(value: unknown): ArticleStats | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const helped = finiteNumber(record.helped);
  const total = finiteNumber(record.total);
  if (helped === undefined || total === undefined) return null;
  if (total <= 0 || helped < 0 || helped > total) return null;
  return { helped: Math.round(helped), total: Math.round(total) };
}

/** Запись из ответа API → статья экрана. Нет id или заголовка — `null` (запись пропускается). */
export function normalizeArticle(value: unknown): KnowledgeArticle | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = textValue(record.id);
  const title = textValue(record.title);
  if (id === '' || title === '') return null;

  const category = textValue(record.category);
  const score = finiteNumber(record.score);
  const stats = normalizeStats(record.stats);

  return {
    id,
    title,
    symptoms: textList(record.symptoms),
    steps: textList(record.steps),
    solution: textValue(record.solution),
    category: category === '' ? null : category,
    ...(score === undefined ? {} : { score }),
    ...(stats === null ? {} : { stats }),
  };
}

function normalizeArticles(articles: readonly unknown[] | null | undefined): KnowledgeArticle[] {
  if (!Array.isArray(articles)) return [];
  const result: KnowledgeArticle[] = [];
  for (const item of articles) {
    const article = normalizeArticle(item);
    if (article) result.push(article);
  }
  return result;
}

/* ---------- Слова запроса ---------- */

/** Служебные слова не участвуют в сравнении — как в поиске ядра. */
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
  'кто',
  'она',
  'они',
  'при',
  'так',
  'уже',
  'что',
  'эти',
  'это',
]);

/** Слова запроса: без регистра и знаков, короче трёх букв и служебные — мимо. */
export function queryWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function sameStem(word: string, candidate: string): boolean {
  const length = Math.min(word.length, candidate.length, 5);
  return length >= 3 && word.slice(0, length) === candidate.slice(0, length);
}

function articleText(article: KnowledgeArticle): string {
  return [article.title, ...article.symptoms, ...article.steps, article.solution].join(' ');
}

/** Сколько слов запроса нашлось в статье (по началу слова: «мигает» ≈ «мигают»). */
function matchCount(words: readonly string[], text: string): number {
  if (words.length === 0) return 0;
  const target = queryWords(text);
  let score = 0;
  for (const word of words) {
    if (target.some((candidate) => sameStem(word, candidate))) score += 1;
  }
  return score;
}

/**
 * Статьи, которые совпали со словами запроса; порядок — по числу совпадений, затем по score.
 * Пустой запрос — вся выдача как есть. Битые записи пропускаются.
 */
export function filterArticles(
  articles: readonly unknown[] | null | undefined,
  query: string,
): KnowledgeArticle[] {
  const normalized = normalizeArticles(articles);
  const words = queryWords(query);
  if (words.length === 0) return normalized;

  return normalized
    .map((article) => ({ article, matches: matchCount(words, articleText(article)) }))
    .filter((entry) => entry.matches > 0)
    .sort(
      (left, right) =>
        right.matches - left.matches ||
        (right.article.score ?? 0) - (left.article.score ?? 0) ||
        left.article.id.localeCompare(right.article.id),
    )
    .map((entry) => entry.article);
}

/* ---------- Список статей ---------- */

export interface ArticleRow {
  id: string;
  title: string;
  category: string | null;
  /** Человеческая подпись категории из `meta.dictionaries`. */
  categoryLabel: string;
  /** Первые симптомы одной строкой: «мышь не двигается · курсор пропал». */
  symptoms: string;
  /** Короткая суть статьи: решение одной фразой, иначе симптомы. */
  summary: string;
  /** Оценка сервера строкой: «3» или «0,42». Не проценты. */
  scoreLabel: string | null;
  /** «помогла 9 из 11» — только если API отдал статистику. */
  helpLabel: string | null;
  article: KnowledgeArticle;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(Math.trunc(Number.isFinite(count) ? count : 0)) % 100;
  const last = absolute % 10;
  if (absolute >= 11 && absolute <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Подписи категорий из `GET /api/meta`: код → «Принтер и печать». */
export function categoryLabels(meta: MetaResponse | null | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const item of meta?.dictionaries ?? []) {
    if (item.dictionary === 'category') labels[item.code] = item.label;
  }
  return labels;
}

/** Подпись категории статьи: из справочника, иначе код, иначе «без категории». */
export function categoryName(
  category: string | null | undefined,
  labels: Readonly<Record<string, string>> = {},
): string {
  const code = (category ?? '').trim();
  if (code === '') return 'без категории';
  return labels[code] ?? code;
}

/** Оценка релевантности от сервера. `ts_rank` — дробь, совпадения слов — целое. */
export function formatScore(score: number | undefined): string | null {
  if (score === undefined || !Number.isFinite(score)) return null;
  if (Number.isInteger(score)) return String(score);
  return score.toFixed(2).replace('.', ',');
}

function symptomsLine(article: KnowledgeArticle): string {
  if (article.symptoms.length === 0) return '';
  return article.symptoms.slice(0, 2).join(' · ');
}

const SENTENCE_END = /[.!?](?:\s|$)/u;

/** Короткая суть статьи: первая фраза решения, иначе симптомы. Длинное обрезаем по слову. */
export function articleSummary(article: KnowledgeArticle, maxLength = 120): string {
  const source = article.solution !== '' ? article.solution : symptomsLine(article);
  const firstSentence = source.split(SENTENCE_END)[0]?.trim() ?? source.trim();
  if (firstSentence.length <= maxLength) return firstSentence;
  const cut = firstSentence.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Статьи без дублей: сервер может вернуть одну и ту же дважды. Порядок и первая запись сохраняются. */
export function dedupeArticles(articles: readonly KnowledgeArticle[]): KnowledgeArticle[] {
  const seen = new Set<string>();
  const result: KnowledgeArticle[] = [];
  for (const article of articles) {
    const key = article.title.trim().toLocaleLowerCase('ru');
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(article);
  }
  return result;
}

/** Подпись статистики строкой: только когда API её отдал. */
export function helpLabel(article: KnowledgeArticle): string | null {
  return articleStats(article)?.label ?? null;
}

/**
 * Строки списка статей для поиска «своими словами».
 * Сервер уже отфильтровал выдачу, поэтому локальное совпадение только уточняет порядок:
 * если слова не совпали ни с одной статьёй, показываем ответ сервера как есть.
 */
export function articleRows(
  articles: readonly unknown[] | null | undefined,
  query = '',
  labels: Readonly<Record<string, string>> = {},
): ArticleRow[] {
  const normalized = dedupeArticles(normalizeArticles(articles));
  const matched = filterArticles(normalized, query);
  const list = query.trim() === '' || matched.length > 0 ? matched : normalized;
  return list.map((article) => ({
    id: article.id,
    title: article.title,
    category: article.category,
    categoryLabel: categoryName(article.category, labels),
    symptoms: symptomsLine(article),
    summary: articleSummary(article),
    scoreLabel: formatScore(article.score),
    helpLabel: helpLabel(article),
    article,
  }));
}

/* ---------- Ответ на вопрос ---------- */

/** Ссылки-источники ответа: только записи с id и заголовком, без дублей. */
export function sourceLinks(sources: readonly unknown[] | null | undefined): AskSource[] {
  if (!Array.isArray(sources)) return [];
  const seen = new Set<string>();
  const result: AskSource[] = [];
  for (const item of sources) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = textValue(record.id);
    const title = textValue(record.title);
    if (id === '' || title === '' || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, title });
  }
  return result;
}

/** Пометка происхождения ответа: без модели — честно пишем это на экране. */
export function askModeLabel(mode: unknown): string {
  if (mode === 'template') return 'ответ по статьям без модели';
  if (mode === 'agent') return 'ответ агента по статьям';
  return 'ответ базы знаний';
}

/* ---------- Шаги и статистика ---------- */

export interface StepProgress {
  done: number;
  total: number;
  /** «выполнено 2 из 5». */
  label: string;
}

/** Ключ отметки шага в состоянии экрана: статья + номер шага. */
export function stepKey(articleId: string, stepIndex: number): string {
  return `${articleId}:${stepIndex}`;
}

/** Прогресс чек-листа: индексы вне списка не считаются (битое состояние не ломает счётчик). */
export function stepsDone(
  steps: readonly unknown[] | null | undefined,
  checked: ReadonlySet<number> | null | undefined,
): StepProgress {
  const total = textList(steps).length;
  let done = 0;
  for (const index of checked ?? []) {
    if (Number.isInteger(index) && index >= 0 && index < total) done += 1;
  }
  return { done, total, label: `выполнено ${done} из ${total}` };
}

export interface ArticleStat {
  helped: number;
  total: number;
  /** «помогла 9 из 11». */
  label: string;
}

/**
 * Статистика статьи — только если API её отдал. Сейчас в схеме `knowledge` полей нет,
 * поэтому на реальном ответе функция возвращает `null` и блок не рисуется.
 */
export function articleStats(article: KnowledgeArticle | null | undefined): ArticleStat | null {
  const stats = normalizeStats(article?.stats);
  if (!stats) return null;
  return { ...stats, label: `помогла ${stats.helped} из ${stats.total}` };
}

/* ---------- Похожие заявки ---------- */

/** Одна формулировка похожих заявок: сколько раз встречалась и какая заявка последняя. */
export interface RelatedGroup {
  title: string;
  count: number;
  number: string;
}

const CANCELLED = 'cancelled';

/**
 * Похожие заявки без простыни: одинаковые формулировки — одна строка со счётчиком.
 * Отменённые не считаем: решения по ним нет.
 */
export function relatedGroups(tickets: readonly SimilarTicket[]): RelatedGroup[] {
  const groups = new Map<string, RelatedGroup>();
  for (const ticket of tickets) {
    if (ticket.status === CANCELLED) continue;
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

/* ---------- Мои активные задачи ---------- */

/** Задачи инженера, которые ещё можно взять в работу или которые уже в работе. */
export function activeTasks(tickets: readonly Ticket[], userId: string): Ticket[] {
  return tickets.filter(
    (ticket) => ticket.assigneeId === userId && (ticket.status === 'assigned' || ticket.status === 'in_progress'),
  );
}

/* ---------- Черновик статьи из решений ---------- */

/** Шаг черновика и статья, из которой он взялся — чтобы инженер видел источник. */
export interface DraftStep {
  text: string;
  articleTitle: string;
}

/** Решение из закрытой заявки: текст и номер заявки-источника. */
export interface DraftSolution {
  text: string;
  number: string;
}

export interface ArticleDraft {
  title: string;
  /** Повторяющиеся формулировки заявок — будущие симптомы статьи. */
  symptoms: string[];
  steps: DraftStep[];
  solutions: DraftSolution[];
  /** Ни шагов, ни решений не нашлось: черновик показываем честно пустым. */
  empty: boolean;
}

export interface DraftInput {
  query: string;
  articles: readonly KnowledgeArticle[];
  tickets: readonly SimilarTicket[];
  resolutions?: readonly DraftSolution[];
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    const key = text.toLocaleLowerCase('ru');
    if (text === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

/**
 * Черновик статьи из того, что уже есть в базе: шаги найденных статей и решения закрытых заявок.
 * Ничего не придумывает: нет источников — черновик пустой, и экран так и говорит.
 */
export function buildDraft({ query, articles, tickets, resolutions = [] }: DraftInput): ArticleDraft {
  const steps: DraftStep[] = [];
  const seenSteps = new Set<string>();
  for (const article of articles) {
    for (const step of article.steps) {
      const text = step.trim();
      const key = text.toLocaleLowerCase('ru');
      if (text === '' || seenSteps.has(key)) continue;
      seenSteps.add(key);
      steps.push({ text, articleTitle: article.title });
      if (steps.length >= 8) break;
    }
    if (steps.length >= 8) break;
  }

  const solutions = resolutions
    .map((solution) => ({ text: solution.text.trim(), number: solution.number }))
    .filter((solution) => solution.text !== '');
  const uniqueSolutions = solutions.filter(
    (solution, index) =>
      solutions.findIndex((candidate) => candidate.text.toLocaleLowerCase('ru') === solution.text.toLocaleLowerCase('ru')) ===
      index,
  );

  const symptoms = uniqueText(tickets.map((ticket) => ticket.title)).slice(0, 3);
  const fallbackTitle = articles[0]?.title ?? symptoms[0] ?? '';
  const title = query.trim() !== '' ? query.trim() : fallbackTitle;

  return {
    title,
    symptoms,
    steps,
    solutions: uniqueSolutions,
    empty: steps.length === 0 && uniqueSolutions.length === 0,
  };
}
