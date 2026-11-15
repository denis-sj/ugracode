import type { MetaResponse, ProfileOptionsResponse, ProfileResponse } from '@ugra/contracts';

/** Подпись подразделения по коду из справочника (`dep-it` → «ИТ-служба»). */
export function departmentLabel(meta: MetaResponse, code: string | null): string {
  if (!code) return 'Не указано';
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'department' && entry.code === code);
  return item?.label ?? code;
}

/** Место из профиля одной строкой: «Корпус Б · 3 этаж · каб. 312». */
export function placeLabel(profile: ProfileResponse['profile']): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.building) parts.push(`Корпус ${profile.building}`);
  if (profile.floor) parts.push(`${profile.floor} этаж`);
  if (profile.cabinet) parts.push(`каб. ${profile.cabinet}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Техника из профиля: подпись из CMDB, иначе инвентарный идентификатор. */
export function equipmentLine(item: ProfileResponse['equipment'][number]): string {
  return item.label?.trim() || item.equipmentId;
}

/** Заполнен ли профиль хотя бы местом или техникой. */
export function profileFilled(profile: ProfileResponse['profile'], equipment: ProfileResponse['equipment']): boolean {
  return Boolean(placeLabel(profile)) || equipment.length > 0;
}

/** Роль по-русски для карточки профиля. */
export const ROLE_TITLE: Record<string, string> = {
  applicant: 'Заявитель',
  dispatcher: 'Диспетчер',
  engineer: 'Инженер',
  manager: 'Руководитель',
  admin: 'Администратор',
};

/**
 * Варианты «Добавить технику»: без уже закреплённой; сначала техника своего кабинета,
 * затем своего корпуса, затем остальная. Подпись — «Принтер HP … · Б-312».
 */
export function equipmentChoices(
  catalog: ProfileOptionsResponse['equipment'],
  profile: ProfileResponse['profile'],
  equipment: ProfileResponse['equipment'],
): { value: string; label: string }[] {
  const taken = new Set(equipment.map((item) => item.equipmentId));
  const rank = (item: ProfileOptionsResponse['equipment'][number]): number => {
    if (!profile?.building || item.building !== profile.building) return 2;
    return item.cabinet === profile.cabinet ? 0 : 1;
  };
  return catalog
    .filter((item) => !taken.has(item.id))
    .map((item) => ({ item, rank: rank(item) }))
    .sort((left, right) => left.rank - right.rank || left.item.label.localeCompare(right.item.label, 'ru'))
    .map(({ item }) => ({
      value: item.id,
      label: item.building && item.cabinet ? `${item.label} · ${item.building}-${item.cabinet}` : item.label,
    }));
}
