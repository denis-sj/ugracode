import type { Ticket, TicketField } from '@ugra/contracts';

/**
 * Чистые правила массовости: место заявки и «похожесть» без эмбеддингов.
 * Всё считается кодом, модель не спрашиваем.
 */

/** Место и система обращения в нормализованном виде. */
export interface TicketPlace {
  category: string | null;
  building: string | null;
  cabinet: string | null;
  /** Система: оргтехника, сеть, серверы, ПО, рабочие места (см. `systemOf`). */
  system: string | null;
}

/** Почему обращение попало в выборку. */
export type SimilarityKind = 'same-category' | 'same-system' | 'mixed-place';

/** Сравнение без регистра, «ё → е» и пробелов по краям. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replaceAll('ё', 'е');
}

/** Значение поля заявки → строка; числа тоже встречаются (кабинет, корпус). */
export function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function fieldValue(fields: readonly TicketField[], key: string): string | null {
  return asText(fields.find((field) => field.fieldKey === key)?.value);
}

/** Категория → система, если по объекту систему определить не удалось. */
const SYSTEM_BY_CATEGORY: Record<string, string> = {
  printer: 'office',
  peripheral: 'office',
  pc: 'workstation',
  network: 'network',
  software: 'software',
  server: 'server',
};

/** Ключевые слова объекта: «МФУ» — оргтехника, «свитч» — сеть, «1С» — ПО. */
const SYSTEM_BY_OBJECT: readonly { words: readonly string[]; system: string }[] = [
  { words: ['принтер', 'мфу', 'сканер', 'мышь', 'клавиатур', 'оргтехник', 'картридж'], system: 'office' },
  { words: ['сеть', 'свитч', 'switch', 'wi-fi', 'wifi', 'интернет', 'роутер', 'маршрутизатор', 'кабел'], system: 'network' },
  { words: ['сервер', 'стойк', 'виртуал', 'резервн'], system: 'server' },
  { words: ['1с', 'почт', 'портал', 'программ', 'сайт', 'егис', 'учетн'], system: 'software' },
  { words: ['компьютер', 'ноутбук', 'пк', 'монитор', 'системн'], system: 'workstation' },
];

/**
 * Система обращения: сначала по объекту (так «МФУ» и «принтер» оказываются одной
 * оргтехникой), иначе по категории. Неизвестная категория — сама себе система.
 */
export function systemOf(category: string | null | undefined, object?: string | null): string | null {
  const objectText = normalizeText(object);
  if (objectText !== '') {
    for (const entry of SYSTEM_BY_OBJECT) {
      if (entry.words.some((word) => objectText.includes(word))) return entry.system;
    }
  }
  const categoryText = normalizeText(category);
  if (categoryText === '') return null;
  return SYSTEM_BY_CATEGORY[categoryText] ?? categoryText;
}

/** Место заявки из полей; категория — из поля, иначе из колонки заявки. */
export function placeOfTicket(ticket: Ticket, fields: readonly TicketField[]): TicketPlace {
  const category = fieldValue(fields, 'category') ?? asText(ticket.category);
  return {
    category,
    building: fieldValue(fields, 'building'),
    cabinet: fieldValue(fields, 'cabinet'),
    system: systemOf(category, fieldValue(fields, 'object')),
  };
}

/** Совпадение нормализованных значений (корпус, категория, система). */
export function sameValue(left: string | null, right: string | null): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return a !== '' && b !== '' && a === b;
}

/** Кабинет сравниваем, только если он известен у обоих; иначе место — весь корпус. */
function sameSpot(left: string | null, right: string | null): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (a === '' || b === '') return true;
  return a === b;
}

/**
 * Один признак похожести или `null`:
 * - `same-category` — та же категория и тот же корпус (главный путь);
 * - `same-system` — одна система в том же корпусе (принтер и МФУ — оргтехника);
 * - `mixed-place` — разные категории в одном месте: вероятно, сеть или сервер.
 */
export function classifyCandidate(target: TicketPlace, candidate: TicketPlace): SimilarityKind | null {
  if (!sameValue(target.building, candidate.building)) return null;
  if (sameValue(target.category, candidate.category)) return 'same-category';
  if (sameValue(target.system, candidate.system)) return 'same-system';
  if (!sameSpot(target.cabinet, candidate.cabinet)) return null;
  return 'mixed-place';
}
