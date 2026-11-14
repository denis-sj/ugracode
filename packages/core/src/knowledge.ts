import type { TicketStatus } from '@ugra/contracts';

/**
 * База знаний на агентном харнессе: поиск инструментами, без эмбеддингов.
 * См. `docs/specs/case9-agent-harness.md`, раздел 4.
 */

/** Статья базы знаний, как её видят инструменты агента и экран инженера. */
export interface KnowledgeArticle {
  id: string;
  title: string;
  symptoms: string[];
  steps: string[];
  solution: string;
  category: string | null;
  /** Совпадения слов (`MemoryStore`) или `ts_rank` (`PgStore`): больше — релевантнее. */
  score?: number;
}

export interface KnowledgeSearchQuery {
  text: string;
  category?: string;
  limit?: number;
}

export interface SimilarTicketQuery {
  text?: string;
  category?: string;
  building?: string;
  limit?: number;
}

/** Похожая заявка для агента: номер, статус и короткое описание проблемы. */
export interface SimilarTicket {
  ticketId: string;
  number: string;
  status: TicketStatus;
  /** Симптомы (или объект) из полей заявки; номер — если полей нет. */
  title: string;
  score: number;
}

/** Сколько статей и заявок возвращаем по умолчанию. */
export const DEFAULT_KNOWLEDGE_LIMIT = 5;

/** Короткие служебные слова не участвуют в поиске: иначе «для» и «это» дают шум. */
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

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const MIN_WORD_LENGTH = 3;
/** Длина общего начала слова: «замятие» и «замятия» — одно слово. */
const STEM_LENGTH = 5;

/** Слова для поиска: без регистра и знаков, служебные и короткие отбрасываются. */
export function knowledgeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter(
      (word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word),
    );
}

function sameStem(word: string, candidate: string): boolean {
  const length = Math.min(word.length, candidate.length, STEM_LENGTH);
  return length >= MIN_WORD_LENGTH && word.slice(0, length) === candidate.slice(0, length);
}

/**
 * Сколько слов запроса встречается в тексте. Сравнение по началу слова, поэтому
 * «мигает» и «мигают», «замятие» и «замятия» считаются совпадением.
 */
export function matchScore(queryWords: readonly string[], text: string): number {
  if (queryWords.length === 0) return 0;
  const target = knowledgeWords(text);
  if (target.length === 0) return 0;
  let score = 0;
  for (const word of queryWords) {
    if (target.some((candidate) => sameStem(word, candidate))) score += 1;
  }
  return score;
}

/** Текст статьи одним куском: по нему идёт поиск по словам. */
export function articleText(article: KnowledgeArticle): string {
  return [article.title, ...article.symptoms, ...article.steps, article.solution].join(' ');
}
