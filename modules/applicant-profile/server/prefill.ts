import type { FieldValue } from '@ugra/contracts';
import type { ApplicantProfile, Equipment, StepContext } from '@ugra/core';

export const PREFILL_STEP_ID = 'profile.prefill';

/** Уверенность подстановки из профиля: место человек подтверждал сам, но текст обращения главнее. */
export const PROFILE_CONFIDENCE = 0.8;

/** Тип техники в CMDB и слова, которыми заявитель называет её в тексте. */
const EQUIPMENT_WORDS: ReadonlyArray<{ type: string; words: readonly string[] }> = [
  { type: 'printer', words: ['принтер'] },
  { type: 'pc', words: ['пк', 'компьютер', 'ноутбук'] },
  { type: 'mfu', words: ['мфу'] },
  { type: 'network', words: ['свитч', 'коммутатор'] },
  { type: 'server', words: ['сервер'] },
];

/** Поля места, которые берём из профиля, если текст их не дал. */
const PLACE_FIELDS: ReadonlyArray<'building' | 'floor' | 'cabinet'> = ['building', 'floor', 'cabinet'];

/** Поля техники: ключ поля → значение из CMDB. */
function equipmentValues(item: Equipment): Array<[string, string | null]> {
  return [
    ['equipment', item.model],
    ['model', item.model],
    ['inventoryNo', item.inventoryNo],
    ['ip', item.ip],
  ];
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

/** Слово в тексте с границей слева: «пк» не должно находиться внутри другого слова. */
function mentions(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zа-яё0-9])${escaped}`, 'u').test(text);
}

/** Тип техники, названный в тексте обращения; несколько типов — первый по порядку списка. */
export function equipmentTypeInText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const group of EQUIPMENT_WORDS) {
    if (group.words.some((word) => mentions(lower, word))) return group.type;
  }
  return null;
}

/** Текст обращения и ответов заявителя: профиль не должен спорить с тем, что человек написал. */
function appealText(ctx: StepContext): string {
  return ctx.draft.sources.map((source) => source.text).join('\n');
}

function profileField(key: string, value: string, at: string): FieldValue {
  return {
    key,
    value,
    confidence: PROFILE_CONFIDENCE,
    quote: null,
    origin: 'profile',
    needsReview: false,
    trace: [{ kind: 'from_profile', step: PREFILL_STEP_ID, at }],
  };
}

/** Значение поля после слияния: текст обращения главнее профиля. */
function placeValue(
  ctx: StepContext,
  profile: ApplicantProfile,
  key: 'building' | 'cabinet',
): string | null {
  const fromText = ctx.draft.fields[key]?.value;
  return isFilled(fromText) ? String(fromText) : profile[key];
}

/**
 * Ровно одна единица техники названного типа в месте заявителя.
 * Несколько единиц — не угадываем; CMDB недоступна — предзаполнение просто не срабатывает.
 */
async function singleEquipment(
  ctx: StepContext,
  type: string,
  building: string | null,
  cabinet: string,
): Promise<Equipment | null> {
  let items: Equipment[];
  try {
    items = await ctx.ports.cmdb.findEquipment(building === null ? { cabinet } : { building, cabinet });
  } catch {
    return null;
  }
  const ofType = items.filter((item) => item.type === type);
  const [only] = ofType;
  return ofType.length === 1 && only ? only : null;
}

/**
 * Предзаполнение из профиля: пустые поля места и техника, если она однозначна.
 * Возвращает только новые поля — текст обращения и прежние находки не перезаписываются.
 */
export async function prefillFromProfile(ctx: StepContext): Promise<Record<string, FieldValue>> {
  const user = ctx.user;
  const db = ctx.db;
  if (!user || !db) return {};
  const profile = await db.getApplicantProfile(user.id);
  if (!profile) return {};

  const at = ctx.ports.clock.now().toISOString();
  const patch: Record<string, FieldValue> = {};

  for (const key of PLACE_FIELDS) {
    if (isFilled(ctx.draft.fields[key]?.value)) continue;
    const value = profile[key];
    if (value === null || value.trim() === '') continue;
    patch[key] = profileField(key, value, at);
  }

  const type = equipmentTypeInText(appealText(ctx));
  if (type === null) return patch;

  const building = placeValue(ctx, profile, 'building');
  const cabinet = placeValue(ctx, profile, 'cabinet');
  if (cabinet === null) return patch;
  const item = await singleEquipment(ctx, type, building, cabinet);
  if (!item) return patch;

  for (const [key, value] of equipmentValues(item)) {
    if (!isFilled(value) || isFilled(ctx.draft.fields[key]?.value)) continue;
    patch[key] = profileField(key, String(value), at);
  }
  return patch;
}
