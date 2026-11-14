import type {
  Appeal,
  Channel,
  DomainEvent,
  PriorityLevel,
  Ticket,
  TicketField,
  TicketStatus,
} from '@ugra/contracts';

/**
 * Детерминированный генератор истории заявок за 6 месяцев (задача 015).
 *
 * Ничего не пишет в базу: возвращает массивы, сид раскладывает их через `KernelStore`.
 * Свой PRNG (mulberry32) вместо faker: одинаковое зерно и одинаковые часы дают тот же набор.
 */

export interface HistoryUser {
  id: string;
  fullName: string;
}

export interface HistoryEngineer {
  id: string;
  fullName: string;
  departmentId: string | null;
  skills: readonly string[];
  buildings: readonly string[];
}

export interface HistoryEquipment {
  id: string;
  type: string;
  model: string;
  building: string;
  cabinet: string;
}

export interface HistorySeedInput {
  /** Конец периода истории: от него отсчитываются 6 месяцев назад. */
  now: Date;
  /** Сколько заявок сгенерировать всего. */
  count?: number;
  /** Длина истории в месяцах (по 30 дней). */
  months?: number;
  /** Зерно PRNG: одно и то же зерно — один и тот же набор. */
  seed?: number;
  users: readonly HistoryUser[];
  engineers: readonly HistoryEngineer[];
  equipment: readonly HistoryEquipment[];
  categories: readonly string[];
  buildings: readonly string[];
  /** Сроки решения по приоритетам в минутах; по умолчанию — из регламента. */
  slaMinutes?: Partial<Record<PriorityLevel, number>>;
}

export interface GeneratedTicket {
  ticket: Ticket;
  fields: TicketField[];
  appeal: Appeal;
  /** Событие `ticket.status.changed` — по нему считается время решения. */
  event: DomainEvent;
}

export interface GeneratedHistory {
  tickets: GeneratedTicket[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COUNT = 600;
const DEFAULT_MONTHS = 6;
const HOT_SPOT_EQUIPMENT_CABINET = '312';
const HOT_SPOT_TICKETS = 7;
const EMERGENCY_TICKETS = 3;
const CANCELLED_SHARE = 0.13;
const OPEN_TICKETS = 4;

/** Категория → подразделение ИТ-службы. */
const CATEGORY_DEPARTMENT: Record<string, string> = {
  printer: 'dep-it',
  pc: 'dep-it',
  peripheral: 'dep-it',
  network: 'dep-network',
  software: 'dep-software',
  server: 'dep-server',
};

/** Категория → тип оборудования в CMDB. */
const CATEGORY_EQUIPMENT_TYPES: Record<string, readonly string[]> = {
  printer: ['printer', 'mfu'],
  pc: ['pc'],
  peripheral: ['peripheral', 'monitor'],
  network: ['network'],
  server: ['server', 'ups'],
  software: [],
};

/** Категория → слово в тексте обращения и в цитате поля. */
const CATEGORY_WORD: Record<string, string> = {
  printer: 'принтер',
  pc: 'компьютер',
  network: 'сеть',
  software: 'программа',
  server: 'сервер',
  peripheral: 'мышь',
};

const SYMPTOMS: Record<string, readonly string[]> = {
  printer: [
    'принтер не печатает, мигает красный индикатор',
    'замятие бумаги, принтер останавливается на второй странице',
    'печатает пустые страницы, тонер закончился на половине документа',
    'задания висят в очереди, принтер не отвечает',
  ],
  pc: [
    'компьютер не включается, индикатор питания мигает',
    'система зависает после входа, приходится перезагружать',
    'не открывается рабочая программа, появляется ошибка',
    'компьютер сильно шумит и выключается во время работы',
  ],
  network: [
    'нет доступа к сети, страницы не открываются',
    'пропадает Wi-Fi на этаже, подключается и отключается',
    'не работает корпоративная почта, пишет об ошибке соединения',
    'нет связи с сервером в производственном корпусе',
  ],
  software: [
    'не открывается 1С, пишет об ошибке лицензии',
    'не приходит почта в Outlook, папка «Входящие» пустая',
    'нет доступа к общей папке отдела, просит пароль',
    'программа закрывается с ошибкой при сохранении документа',
  ],
  server: [
    'сервер не отвечает, сервисы недоступны',
    'заканчивается место на диске, резервное копирование не прошло',
    'ИБП пищит и перешёл на батареи',
    'не поднимается тестовая среда после обновления',
  ],
  peripheral: [
    'мышь не работает, курсор не двигается',
    'клавиатура не реагирует на нажатия',
    'монитор мигает и гаснет',
    'сканер не определяется компьютером',
  ],
};

const EMERGENCY_TEXTS = [
  'Корпус Б, кабинет 210. Из ИБП пошёл дым, пахнет горелым, искрит розетка.',
  'Корпус В, кабинет 104. Серверная стойка обесточена, сервисы недоступны, слышен запах плавленой изоляции.',
  'Корпус А, кабинет 305. Коммутатор искрит и дымится, сеть на этаже полностью пропала.',
];

const WEEKDAY_WEIGHTS: readonly number[] = [0.08, 2.2, 1.35, 1.3, 1.2, 1.1, 0.18];

/** Нагрузка по корпусам: в промплощадке сотрудников меньше, чем в офисных корпусах. */
const BUILDING_WEIGHTS: Record<string, number> = { А: 3, Б: 3.6, В: 2.6, ПРОМ: 1 };
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
const HOUR_WEIGHTS: readonly number[] = [0.5, 1.6, 1.4, 1.2, 0.7, 0.9, 1.4, 1.3, 1.1, 0.8, 0.4];

const PRIORITY_WEIGHTS: readonly { value: PriorityLevel; weight: number }[] = [
  { value: 'critical', weight: 8 },
  { value: 'high', weight: 22 },
  { value: 'medium', weight: 44 },
  { value: 'low', weight: 26 },
];

const DEFAULT_SLA_MINUTES: Record<PriorityLevel, number> = {
  emergency: 60,
  critical: 240,
  high: 480,
  medium: 1440,
  low: 4320,
};

const DEFAULT_REACT_MINUTES: Record<PriorityLevel, number> = {
  emergency: 15,
  critical: 60,
  high: 120,
  medium: 240,
  low: 480,
};

const CHANNELS: readonly { value: Channel; weight: number }[] = [
  { value: 'chat', weight: 45 },
  { value: 'phone', weight: 30 },
  { value: 'email', weight: 15 },
  { value: 'screenshot', weight: 10 },
];

const BUILDING_CODES: Record<string, string> = {
  А: 'a',
  Б: 'b',
  В: 'v',
  ПРОМ: 'prom',
};

/** Внутренний план заявки до присвоения id. */
interface TicketPlan {
  createdAt: Date;
  status: TicketStatus;
  priority: PriorityLevel;
  category: string;
  building: string;
  cabinet: string;
  equipment: HistoryEquipment | null;
  engineer: HistoryEngineer;
  symptoms: string;
  /** Время решения в минутах; `null` — заявка ещё открыта. */
  resolutionMinutes: number | null;
}

/** mulberry32: 32-битный PRNG, одинаковый на всех платформах. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function pick<T>(random: () => number, items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[pickIndex(random, items.length)] ?? null;
}

interface Weighted<T> {
  value: T;
  weight: number;
}

function pickWeighted<T>(random: () => number, items: readonly Weighted<T>[]): T | null {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || items.length === 0) return null;
  let threshold = random() * total;
  for (const item of items) {
    threshold -= item.weight;
    if (threshold <= 0) return item.value;
  }
  return items[items.length - 1]?.value ?? null;
}

function minutesLater(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function dayStart(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function withTime(day: Date, hour: number, minute: number, second: number): Date {
  const copy = dayStart(day);
  copy.setHours(hour, minute, second, 0);
  return copy;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** id кабинета в CMDB — та же формула, что в `packages/db/src/seed/load-data.ts`. */
export function cabinetLocationId(building: string, cabinet: string): string {
  const code = BUILDING_CODES[building] ?? building.toLowerCase();
  return `cab-${code}-${cabinet}`;
}

/** День недели с понедельником в понедельнике и повышенным весом (пик обращений). */
function buildDays(now: Date, months: number): Weighted<Date>[] {
  const days: Weighted<Date>[] = [];
  const total = Math.max(1, Math.round(months * 30));
  const start = dayStart(new Date(now.getTime() - total * DAY_MS));
  for (let offset = 0; offset < total; offset += 1) {
    const day = new Date(start.getTime() + offset * DAY_MS);
    const weekday = day.getDay();
    days.push({ value: day, weight: WEEKDAY_WEIGHTS[weekday] ?? 1 });
  }
  return days;
}

/** Свежее время в рабочих часах: для открытых заявок, которые ещё в работе. */
function recentWorkingTime(now: Date, index: number): Date {
  let moment = new Date(now.getTime() - (index + 1) * 4 * 60 * 60_000);
  const hour = moment.getHours();
  if (hour < 8 || hour > 18) {
    moment = new Date(moment.getTime() - DAY_MS);
  }
  return withTime(moment, Math.min(17, Math.max(9, index + 9)), 15, 0);
}

function pickCreatedAt(random: () => number, days: readonly Weighted<Date>[]): Date {
  const day = pickWeighted(random, days) ?? new Date();
  const hour = pickWeighted(
    random,
    HOURS.map((value, index) => ({ value, weight: HOUR_WEIGHTS[index] ?? 1 })),
  );
  const hourValue = hour ?? 10;
  return withTime(day, hourValue, pickIndex(random, 60), pickIndex(random, 60));
}

function pickEngineer(
  random: () => number,
  engineers: readonly HistoryEngineer[],
  category: string,
  building: string,
): HistoryEngineer | null {
  if (engineers.length === 0) return null;
  const department = CATEGORY_DEPARTMENT[category] ?? null;
  const byDepartment = engineers.filter((item) => !department || item.departmentId === department);
  const inBuilding = byDepartment.filter((item) => item.buildings.includes(building));
  const pool = inBuilding.length > 0 ? inBuilding : byDepartment.length > 0 ? byDepartment : engineers;
  return pick(random, pool);
}

function pickEquipment(
  random: () => number,
  equipment: readonly HistoryEquipment[],
  category: string,
  building: string,
  cabinet?: string,
): HistoryEquipment | null {
  const types = CATEGORY_EQUIPMENT_TYPES[category] ?? [];
  if (types.length === 0) return null;
  const sameBuilding = equipment.filter(
    (item) => types.includes(item.type) && item.building === building,
  );
  const sameCabinet = cabinet
    ? sameBuilding.filter((item) => item.cabinet === cabinet)
    : [];
  const pool = sameCabinet.length > 0 ? sameCabinet : sameBuilding;
  if (pool.length > 0) return pick(random, pool);
  return pick(
    random,
    equipment.filter((item) => types.includes(item.type)),
  );
}

function resolutionRange(priority: PriorityLevel): { min: number; max: number } {
  switch (priority) {
    case 'emergency':
      return { min: 25, max: 75 };
    case 'critical':
      return { min: 90, max: 260 };
    case 'high':
      return { min: 150, max: 500 };
    case 'medium':
      return { min: 240, max: 1500 };
    default:
      return { min: 360, max: 4400 };
  }
}

function pickResolution(random: () => number, priority: PriorityLevel): number {
  const { min, max } = resolutionRange(priority);
  const base = min + Math.floor(random() * (max - min));
  // Примерно каждая восьмая заявка закрыта с нарушением срока SLA.
  return random() < 0.12 ? Math.round(base * (1.5 + random())) : base;
}

function statusFor(random: () => number, normalIndex: number): TicketStatus {
  if (normalIndex < OPEN_TICKETS) {
    return normalIndex % 2 === 0 ? 'in_review' : 'assigned';
  }
  if (random() < CANCELLED_SHARE) return 'cancelled';
  return random() < 0.45 ? 'resolved' : 'closed';
}

function defaultSymptoms(category: string): string {
  return SYMPTOMS[category]?.[0] ?? 'оборудование не работает';
}

/** Собирает тексты, цитаты и поля из плана заявки. */
function materialize(
  plan: TicketPlan,
  index: number,
  daySequence: Map<string, number>,
  authorId: string,
  channel: Channel,
): GeneratedTicket {
  const createdIso = plan.createdAt.toISOString();
  const dateKey = isoDate(plan.createdAt);
  const sequence = (daySequence.get(dateKey) ?? 0) + 1;
  daySequence.set(dateKey, sequence);

  const suffix = pad(index + 1, 4);
  const ticketId = `ticket-hist-${suffix}`;
  const appealId = `appeal-hist-${suffix}`;
  const number = `З-${dateKey.replaceAll('-', '')}-${pad(sequence, 4)}`;

  const objectWord = plan.equipment?.model ?? CATEGORY_WORD[plan.category] ?? 'оборудование';
  const originalText = `Корпус ${plan.building}, кабинет ${plan.cabinet}. ${objectWord}: ${plan.symptoms}.`;

  const appeal: Appeal = {
    id: appealId,
    channel,
    authorId,
    originalText,
    attachments: [],
    createdAt: createdIso,
  };

  const slaMinutes = DEFAULT_SLA_MINUTES[plan.priority];
  const reactMinutes = DEFAULT_REACT_MINUTES[plan.priority];
  const resolutionAt =
    plan.resolutionMinutes === null ? null : minutesLater(plan.createdAt, plan.resolutionMinutes);
  const updatedAt = (resolutionAt ?? plan.createdAt).toISOString();

  const ticket: Ticket = {
    id: ticketId,
    number,
    appealId,
    status: plan.status,
    priority: plan.priority,
    category: plan.category,
    departmentId: plan.engineer.departmentId,
    assigneeId: plan.engineer.id,
    isEmergency: plan.priority === 'emergency',
    incidentId: null,
    reactDueAt: minutesLater(plan.createdAt, reactMinutes).toISOString(),
    slaDueAt: minutesLater(plan.createdAt, slaMinutes).toISOString(),
    equipmentId: plan.equipment?.id ?? null,
    locationId: cabinetLocationId(plan.building, plan.cabinet),
    confirmedBy: null,
    confirmedAt: null,
    createdAt: createdIso,
    updatedAt,
  };

  const field = (key: string, value: string, quote: string, confidence: number): TicketField => ({
    ticketId,
    fieldKey: key,
    value,
    confidence,
    quote: { sourceId: appealId, text: quote },
    origin: 'text',
    needsReview: false,
    trace: [{ kind: 'found', step: 'history-seed', at: createdIso, quote }],
    aiValue: value,
  });

  const fields: TicketField[] = [
    field('category', plan.category, CATEGORY_WORD[plan.category] ?? plan.category, 0.97),
    field('building', plan.building, `Корпус ${plan.building}`, 0.95),
    field('cabinet', plan.cabinet, `кабинет ${plan.cabinet}`, 0.93),
    field('symptoms', plan.symptoms, plan.symptoms, 0.88),
  ];
  if (plan.equipment) {
    fields.splice(3, 0, field('equipment', plan.equipment.model, plan.equipment.model, 0.9));
  }

  const from: TicketStatus =
    plan.resolutionMinutes === null ? 'new' : plan.status === 'cancelled' ? 'in_review' : 'in_progress';
  const event: DomainEvent = {
    id: `event-hist-${suffix}`,
    type: 'ticket.status.changed',
    at: (resolutionAt ?? minutesLater(plan.createdAt, 20)).toISOString(),
    actor: { kind: 'user', id: plan.engineer.id },
    ticketId,
    payload: {
      from,
      to: plan.status,
      resolutionMinutes: plan.resolutionMinutes,
      resolvedAt: resolutionAt?.toISOString() ?? null,
    },
  };

  return { ticket, fields, appeal, event };
}

/** Кабинеты корпуса из CMDB: место выбираем как рабочее место, а не как «пул техники». */
function cabinetsOf(equipment: readonly HistoryEquipment[], building: string): string[] {
  const cabinets = new Set<string>();
  for (const item of equipment) {
    if (item.building === building) cabinets.add(item.cabinet);
  }
  return [...cabinets].sort((left, right) => left.localeCompare(right));
}

/** Техника нужного типа в выбранном кабинете; нет — заявка останется без `equipmentId`. */
function equipmentAt(
  equipment: readonly HistoryEquipment[],
  category: string,
  building: string,
  cabinet: string,
): HistoryEquipment | null {
  const types = CATEGORY_EQUIPMENT_TYPES[category] ?? [];
  if (types.length === 0) return null;
  return (
    equipment.find(
      (item) => types.includes(item.type) && item.building === building && item.cabinet === cabinet,
    ) ?? null
  );
}

function buildPlans(input: HistorySeedInput, random: () => number): TicketPlan[] {
  const categories = input.categories.length > 0 ? input.categories : Object.keys(CATEGORY_WORD);
  const buildings = input.buildings.length > 0 ? input.buildings : ['А', 'Б', 'В', 'ПРОМ'];
  const count = Math.max(1, Math.round(input.count ?? DEFAULT_COUNT));
  const months = input.months ?? DEFAULT_MONTHS;
  const days = buildDays(input.now, months);
  const plans: TicketPlan[] = [];

  const engineerFor = (category: string, building: string): HistoryEngineer | null =>
    pickEngineer(random, input.engineers, category, building) ?? input.engineers[0] ?? null;

  // «Больной» принтер в кабинете 312: 7 обращений за полгода.
  const printer312 =
    input.equipment.find(
      (item) =>
        item.cabinet === HOT_SPOT_EQUIPMENT_CABINET && (item.type === 'printer' || item.type === 'mfu'),
    ) ??
    input.equipment.find((item) => item.type === 'printer') ??
    null;
  const hotBuilding = printer312?.building ?? 'Б';
  const hotCabinet = printer312?.cabinet ?? HOT_SPOT_EQUIPMENT_CABINET;
  for (let index = 0; index < HOT_SPOT_TICKETS; index += 1) {
    const createdAt = withTime(
      new Date(input.now.getTime() - (index * 19 + 6) * DAY_MS),
      9 + (index % 3),
      10 + index,
      0,
    );
    const engineer = engineerFor('printer', hotBuilding);
    if (!engineer) break;
    const priority: PriorityLevel = index === 0 ? 'critical' : index < 4 ? 'high' : 'medium';
    plans.push({
      createdAt,
      status: 'closed',
      priority,
      category: 'printer',
      building: hotBuilding,
      cabinet: hotCabinet,
      equipment: printer312,
      engineer,
      symptoms:
        SYMPTOMS['printer']?.[index % (SYMPTOMS['printer']?.length ?? 1)] ??
        defaultSymptoms('printer'),
      resolutionMinutes: pickResolution(random, priority),
    });
  }

  // Три аварии за полгода.
  for (let index = 0; index < EMERGENCY_TICKETS; index += 1) {
    const category = index === 1 ? 'server' : 'network';
    const createdAt = withTime(
      new Date(input.now.getTime() - (index * 47 + 22) * DAY_MS),
      14 + index,
      5,
      0,
    );
    const equipment = pickEquipment(random, input.equipment, category, buildings[index % buildings.length] ?? 'Б');
    const building = equipment?.building ?? buildings[(index + 1) % buildings.length] ?? 'Б';
    const engineer = engineerFor(category, building);
    if (!engineer) continue;
    plans.push({
      createdAt,
      status: 'closed',
      priority: 'emergency',
      category,
      building,
      cabinet: equipment?.cabinet ?? '210',
      equipment,
      engineer,
      symptoms: EMERGENCY_TEXTS[index] ?? defaultSymptoms(category),
      resolutionMinutes: 35 + index * 15,
    });
  }

  // Остальные заявки — по взвешенному распределению дня, часа и приоритета.
  const normalCount = Math.max(0, count - plans.length);
  for (let index = 0; index < normalCount; index += 1) {
    const category = pick(random, categories) ?? 'printer';
    const building =
      pickWeighted(
        random,
        buildings.map((value) => ({ value, weight: BUILDING_WEIGHTS[value] ?? 1 })),
      ) ?? 'Б';
    // Открытые заявки — свежие: иначе в демо все они выглядят просроченными.
    const createdAt =
      index < OPEN_TICKETS ? recentWorkingTime(input.now, index) : pickCreatedAt(random, days);
    const priority = pickWeighted(random, PRIORITY_WEIGHTS) ?? 'medium';
    const cabinets = cabinetsOf(input.equipment, building);
    let cabinet = pick(random, cabinets) ?? String(100 + pickIndex(random, 300));
    // «Больной» принтер в 312 тянет к себе часть обращений по печати в корпусе Б.
    if (category === 'printer' && building === hotBuilding && random() < 0.45) {
      cabinet = hotCabinet;
    }
    const equipment = equipmentAt(input.equipment, category, building, cabinet);
    const engineer = engineerFor(category, building);
    if (!engineer) continue;

    const status = statusFor(random, index);
    const open = status === 'in_review' || status === 'assigned';
    plans.push({
      createdAt,
      status,
      priority,
      category,
      building,
      cabinet,
      equipment,
      engineer,
      symptoms: pick(random, SYMPTOMS[category] ?? []) ?? defaultSymptoms(category),
      resolutionMinutes: open ? null : pickResolution(random, priority),
    });
  }

  return plans.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function pickChannel(random: () => number): Channel {
  return pickWeighted(random, CHANNELS) ?? 'chat';
}

/** Генерирует историю: заявки, поля, оригиналы обращений и события смены статуса. */
export function generateHistory(input: HistorySeedInput): GeneratedHistory {
  const random = createRandom(input.seed ?? 20261114);
  const plans = buildPlans(input, random);
  const users =
    input.users.length > 0
      ? input.users
      : input.engineers.map((engineer) => ({ id: engineer.id, fullName: engineer.fullName }));
  const daySequence = new Map<string, number>();

  const tickets = plans.map((plan, index) => {
    const author = users.length > 0 ? users[pickIndex(random, users.length)] : null;
    return materialize(plan, index, daySequence, author?.id ?? '', pickChannel(random));
  });

  return { tickets };
}

/** Сколько заявок считается «уже засеянной базой»: повторный сид не дублирует историю. */
export const HISTORY_SEED_THRESHOLD = 300;
