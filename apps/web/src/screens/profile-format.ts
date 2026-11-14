import type { MetaResponse, ProfileResponse } from '@ugra/contracts';

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
