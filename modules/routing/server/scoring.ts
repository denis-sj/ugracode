import type { AssigneeCandidate } from '@ugra/contracts';
import type { EngineerProfile } from '../contracts';

/**
 * Подразделение по категории заявки — запасной путь, когда подразделение не пришло полем.
 * Категории — коды из `data/dictionaries.json`.
 */
export const DEPARTMENT_BY_CATEGORY: Record<string, string> = {
  printer: 'dep-it',
  pc: 'dep-it',
  network: 'dep-network',
  software: 'dep-software',
  server: 'dep-server',
};

/** Категория не названа или незнакомая — отдаём в сервисную службу. */
export const DEFAULT_DEPARTMENT = 'dep-service';

/** Как подразделение называется в объяснении; незнакомый id показываем как есть. */
export const DEPARTMENT_TITLES: Record<string, string> = {
  'dep-it': 'ИТ',
  'dep-network': 'сети',
  'dep-software': 'ПО',
  'dep-server': 'серверы',
  'dep-service': 'сервисная служба',
};

/** Веса факторов подбора (раздел 5.3 спецификации). Меняются здесь, а не в шаге и не в маршруте. */
export const WEIGHTS = {
  /** Подразделение инженера совпало с подразделением по категории заявки. */
  department: 40,
  /** Совпал навык — добавляем уровень навыка (1..5), умноженный на этот вес. */
  skill: 10,
  /** Инженер сейчас на смене. */
  onShift: 20,
  /** Инженер закреплён за корпусом из заявки. */
  building: 15,
  /** Минус за каждую открытую заявку: не перегружаем человека. */
  openTicket: -2,
  /** Решал похожие заявки: умножаем на min(число, 10). */
  resolvedSimilar: 2,
} as const;

/** Больше десяти похожих решённых заявок балл не увеличивают: дальше не отличаем. */
export const RESOLVED_SIMILAR_CAP = 10;
/** Сколько кандидатов показываем в карточке и в черновике. */
export const TOP_LIMIT = 3;
/** Разрыв меньше 15 % от лучшего балла — уверенности нет, выбор за диспетчером. */
export const CONFIDENCE_GAP_RATIO = 0.15;

export interface ScoringInput {
  engineers: readonly EngineerProfile[];
  /** Категория заявки (код справочника). */
  category?: string | null;
  /** Оборудование из полей заявки. */
  equipment?: string | null;
  /** Корпус из полей заявки. */
  building?: string | null;
  /** Исходный текст обращения: по нему ловим навыки, которых нет в полях. */
  text?: string | null;
  /** Авария: добавляет в объяснение пометку про подтверждение диспетчера. */
  emergency?: boolean;
}

interface ScoredCandidate {
  candidate: AssigneeCandidate;
  onShift: boolean;
}

interface EngineerContext {
  departmentId: string;
  building: string;
  haystack: string;
}

/** Подразделение по коду категории; неизвестная категория → сервисная служба. */
export function departmentFor(category: string | null | undefined): string {
  return DEPARTMENT_BY_CATEGORY[normalize(category ?? '')] ?? DEFAULT_DEPARTMENT;
}

/**
 * Оценка инженеров кодом: топ-3 по баллу, при равенстве — по id.
 * Вся математика подбора живёт здесь, шаг и маршрут переиспользуют функцию.
 */
export function scoreCandidates(input: ScoringInput): AssigneeCandidate[] {
  const context: EngineerContext = {
    departmentId: departmentFor(input.category),
    building: normalize(input.building ?? ''),
    haystack: normalize([input.text, input.category, input.equipment].filter(Boolean).join(' ')),
  };
  const scored = input.engineers.map((engineer) => scoreEngineer(engineer, context));
  scored.sort(
    (a, b) => b.candidate.score - a.candidate.score || a.candidate.userId.localeCompare(b.candidate.userId),
  );
  const top = scored.slice(0, TOP_LIMIT);
  markLowConfidence(top, input.emergency === true);
  return top.map((item) => item.candidate);
}

function scoreEngineer(engineer: EngineerProfile, context: EngineerContext): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;

  if (engineer.departmentId !== '' && engineer.departmentId === context.departmentId) {
    score += WEIGHTS.department;
    reasons.push(`подразделение «${departmentTitle(engineer.departmentId)}»`);
  }

  for (const skill of engineer.skills) {
    if (!matchesSkill(skill.skill, context.haystack)) continue;
    score += skill.level * WEIGHTS.skill;
    reasons.push(`навык „${skill.skill}“ — уровень ${skill.level}`);
  }

  if (engineer.onShift) {
    score += WEIGHTS.onShift;
    reasons.push('на смене');
  } else {
    reasons.push('не на смене');
  }

  if (context.building !== '' && engineer.buildings.some((item) => normalize(item) === context.building)) {
    score += WEIGHTS.building;
    reasons.push(`корпус ${context.building.toUpperCase()}`);
  }

  if (engineer.openTickets > 0) {
    score += engineer.openTickets * WEIGHTS.openTicket;
    reasons.push(openTicketsLabel(engineer.openTickets));
  }

  if (engineer.resolvedSimilar > 0) {
    const similar = Math.min(engineer.resolvedSimilar, RESOLVED_SIMILAR_CAP);
    score += similar * WEIGHTS.resolvedSimilar;
    reasons.push(similarLabel(similar));
  }

  return { candidate: { userId: engineer.id, score, reasons }, onShift: engineer.onShift };
}

/**
 * Малая уверенность: разрыв с вторым местом меньше порога, лидер не на смене
 * или лучший балл не положительный (доказательств нет). Тогда решает диспетчер.
 */
function markLowConfidence(top: readonly ScoredCandidate[], emergency: boolean): void {
  const leader = top[0];
  if (leader === undefined) return;
  const best = leader.candidate.score;
  const runnerUp = top[1];
  const smallGap =
    runnerUp !== undefined && best - runnerUp.candidate.score < Math.abs(best) * CONFIDENCE_GAP_RATIO;
  if (!smallGap && best > 0 && leader.onShift) return;
  leader.candidate.reasons.push(
    emergency ? 'авария: нужно подтверждение диспетчера' : 'нужно подтверждение диспетчера',
  );
}

function departmentTitle(departmentId: string): string {
  return DEPARTMENT_TITLES[departmentId] ?? departmentId;
}

/** Совпал ли навык с текстом, категорией или оборудованием: сравниваем слова и их основы. */
function matchesSkill(skill: string, haystack: string): boolean {
  if (haystack === '') return false;
  return normalize(skill)
    .split(/[^a-zа-я0-9]+/)
    .filter((word) => word.length >= 2)
    .some((word) => haystack.includes(word) || (word.length >= 4 && haystack.includes(word.slice(0, 4))));
}

function openTicketsLabel(count: number): string {
  return `${count} ${plural(count, 'открытая заявка', 'открытые заявки', 'открытых заявок')}`;
}

function similarLabel(count: number): string {
  return `решил ${count} ${plural(count, 'похожую', 'похожие', 'похожих')}`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}
