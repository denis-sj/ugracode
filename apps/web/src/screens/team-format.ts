import type { Role, User } from '@ugra/contracts';
import { ROLE_TITLE } from './profile-format';

/** Порядок групп на экране «Сотрудники»: от управления к заявителям. */
export const TEAM_ORDER: readonly Role[] = ['manager', 'dispatcher', 'engineer', 'applicant', 'admin'];

/** Варианты роли в выпадающем списке. */
export const ROLE_OPTIONS: readonly { value: Role; label: string }[] = TEAM_ORDER.map((role) => ({
  value: role,
  label: ROLE_TITLE[role] ?? role,
}));

/** Служебные учётки (гость демо, звонок по QR) — не сотрудники, в списке их нет. */
const SERVICE_USERS = new Set(['guest', 'u-call-guest']);

/** Заголовок группы во множественном числе. */
const GROUP_TITLE: Record<Role, string> = {
  manager: 'Руководители',
  dispatcher: 'Диспетчеры',
  engineer: 'Инженеры',
  applicant: 'Заявители',
  admin: 'Администраторы',
};

export function roleTitle(role: Role): string {
  return ROLE_TITLE[role] ?? role;
}

export interface TeamGroup {
  role: Role;
  title: string;
  users: User[];
}

/** Сотрудники по ролям, внутри — по алфавиту; пустые группы не показываем. */
export function teamGroups(users: readonly User[]): TeamGroup[] {
  return TEAM_ORDER.map((role) => ({
    role,
    title: GROUP_TITLE[role],
    users: users
      .filter((user) => user.role === role && !SERVICE_USERS.has(user.id))
      .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru')),
  })).filter((group) => group.users.length > 0);
}
