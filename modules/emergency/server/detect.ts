import type { EmergencySign, EmergencyVerdict } from '@ugra/contracts';
import {
  readModelEmergency,
  type EmergencyChecklist,
  type EmergencyEngineer,
  type EmergencyRule,
  type EmergencyRulesFile,
} from '../contracts';

/**
 * Детектор аварии: два независимых сигнала — правила из `data/emergency-rules.json` и мнение
 * модели (`draft.ext.extraction.emergency`). Всё — код, без обращения к модели и внешним портам.
 *
 * | Правила | Модель | Итог |
 * |---|---|---|
 * | да | да | `confirmed` |
 * | сработал один | — | `suspected` |
 * | нет | нет | `none` |
 */

/** Уверенность сигнала правил: детерминированное совпадение, но не «абсолютная истина». */
export const RULE_CONFIDENCE = 0.9;

/** Сколько цитат берём с одного правила: карточке хватает, а вердикт не разрастается. */
const MAX_QUOTES_PER_RULE = 6;

/** Буква или цифра: по ним проверяем, что совпадение начинается с начала слова. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Сравнение без регистра и «ё → е»; длина строки не меняется, поэтому индексы годятся для цитат. */
export function normalizeEmergencyText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

function startsWord(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !WORD_CHAR.test(text[index - 1] ?? '');
}

function uniqueQuotes(quotes: readonly string[]): string[] {
  return [...new Set(quotes.filter((quote) => quote.trim() !== ''))];
}

/** Совпадения слов (подстрока с начала слова): «вода» не находится внутри «провода». */
function literalQuotes(haystack: string, text: string, words: readonly string[]): string[] {
  const quotes: string[] = [];
  for (const word of words) {
    const needle = normalizeEmergencyText(word);
    if (needle === '') continue;
    let from = 0;
    while (quotes.length < MAX_QUOTES_PER_RULE) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      if (startsWord(haystack, index)) quotes.push(text.slice(index, index + needle.length));
      from = index + 1;
    }
  }
  return uniqueQuotes(quotes);
}

/** Совпадения regex-шаблонов; битый шаблон считается обычной подстрокой и не роняет шаг. */
function patternQuotes(haystack: string, text: string, patterns: readonly string[]): string[] {
  const quotes: string[] = [];
  for (const pattern of patterns) {
    let expression: RegExp;
    try {
      expression = new RegExp(normalizeEmergencyText(pattern), 'g');
    } catch {
      quotes.push(...literalQuotes(haystack, text, [pattern]));
      continue;
    }
    for (const match of haystack.matchAll(expression)) {
      if (quotes.length >= MAX_QUOTES_PER_RULE) break;
      const value = match[0];
      const index = match.index ?? 0;
      if (value === '' || !startsWord(haystack, index)) continue;
      quotes.push(text.slice(index, index + value.length));
    }
  }
  return uniqueQuotes(quotes);
}

/** Признаки одного правила: свои у каждого знака-объекта и общие слова/шаблоны самого правила. */
export function ruleSigns(rule: EmergencyRule, text: string): EmergencySign[] {
  const haystack = normalizeEmergencyText(text);
  const signs: EmergencySign[] = [];

  for (const sign of rule.signs) {
    if (typeof sign === 'string') continue;
    const quotes = [
      ...literalQuotes(haystack, text, sign.words),
      ...patternQuotes(haystack, text, sign.patterns),
    ];
    for (const quote of uniqueQuotes(quotes).slice(0, MAX_QUOTES_PER_RULE)) {
      signs.push({ sign: sign.sign, quote });
    }
  }

  // Общие слова правила не привязаны к коду признака: подписываем их id правила,
  // чтобы в карточке было видно, какое правило сработало.
  const common = [
    ...literalQuotes(haystack, text, rule.words),
    ...patternQuotes(haystack, text, rule.patterns),
  ];
  for (const quote of uniqueQuotes(common).slice(0, MAX_QUOTES_PER_RULE)) {
    signs.push({ sign: rule.id, quote });
  }

  return dedupeSigns(signs);
}

function dedupeSigns(signs: readonly EmergencySign[]): EmergencySign[] {
  const seen = new Set<string>();
  const result: EmergencySign[] = [];
  for (const sign of signs) {
    const key = `${sign.sign}\u0000${sign.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ sign: sign.sign, quote: sign.quote });
  }
  return result;
}

/** Шаги регламента правила: свои `checklist` + чек-лист по `checklistId`, без повторов. */
export function checklistFor(rule: EmergencyRule, checklists: readonly EmergencyChecklist[]): string[] {
  const steps = [...rule.checklist];
  if (rule.checklistId) {
    const checklist = checklists.find((item) => item.id === rule.checklistId);
    if (checklist) steps.push(...checklist.steps);
  }
  return [...new Set(steps.filter((step) => step.trim() !== ''))];
}

function normalizedSkill(skill: string): string {
  return normalizeEmergencyText(skill).trim();
}

/**
 * Дежурные для уведомления. По каждому сработавшему правилу: инженеры `onShift` с навыком правила,
 * а если правило навык не задаёт — все на смене. Навыка нет ни у кого — никого не уведомляем.
 */
export function pickDutyEngineers(
  engineers: readonly EmergencyEngineer[],
  rules: readonly EmergencyRule[],
): string[] {
  const onShift = engineers.filter((engineer) => engineer.onShift);
  const picked: string[] = [];

  for (const rule of rules) {
    const skills = new Set(rule.skills.map(normalizedSkill).filter((skill) => skill !== ''));
    const chosen =
      skills.size === 0
        ? onShift
        : onShift.filter((engineer) =>
            engineer.skills.some((skill) => skills.has(normalizedSkill(skill.skill))),
          );
    for (const engineer of chosen) {
      if (!picked.includes(engineer.id)) picked.push(engineer.id);
    }
  }

  return picked.sort((left, right) => left.localeCompare(right));
}

export interface DetectEmergencyInput {
  /** Текст обращения: склеенные источники черновика. */
  text: string;
  rules: EmergencyRulesFile;
  /** Инженеры из `data.extra.engineers`. */
  engineers?: readonly EmergencyEngineer[];
  /** `draft.ext` целиком: оттуда берём мнение модели, если оно есть. */
  ext?: unknown;
}

export interface RuleHit {
  rule: EmergencyRule;
  signs: EmergencySign[];
}

/** Сработавшие правила с признаками и цитатами — для события и объяснения в интерфейсе. */
export function matchedRules(rules: EmergencyRulesFile, text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of rules.rules) {
    const signs = ruleSigns(rule, text);
    if (signs.length > 0) hits.push({ rule, signs });
  }
  return hits;
}

export function detectEmergency(input: DetectEmergencyInput): EmergencyVerdict {
  const hits = matchedRules(input.rules, input.text);
  const rulesHit = hits.length > 0;
  const model = readModelEmergency(input.ext);
  const modelHit = model.suspected;

  const level = rulesHit && modelHit ? 'confirmed' : rulesHit || modelHit ? 'suspected' : 'none';
  const checklist: string[] = [];
  for (const hit of hits) {
    for (const step of checklistFor(hit.rule, input.rules.checklists)) {
      if (!checklist.includes(step)) checklist.push(step);
    }
  }

  const signs = dedupeSigns([...hits.flatMap((hit) => hit.signs), ...(modelHit ? model.signs : [])]);

  return {
    level,
    signs,
    confidence: Math.max(rulesHit ? RULE_CONFIDENCE : 0, modelHit ? model.confidence : 0),
    rulesMatched: [...new Set(hits.map((hit) => hit.rule.id))],
    checklist,
    notifyUserIds: pickDutyEngineers(
      input.engineers ?? [],
      hits.map((hit) => hit.rule),
    ),
  };
}
