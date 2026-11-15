import { randomUUID } from 'node:crypto';
import {
  CreateUserInput,
  ProfileEquipmentInput,
  ProfileOptionsResponse,
  ProfilePlaceInput,
  UpdateUserRoleInput,
  type DictionaryItem,
  type User,
} from '@ugra/contracts';
import type { ApplicantProfile, KernelStore, ReferenceData } from '@ugra/core';
import type { RouteDef } from './server';

/**
 * Люди и рабочие места: профиль (где сижу, моя техника) и сотрудники руководителя.
 * Место и техника — для любого вошедшего; заводить сотрудников и менять роли — право `settings`.
 */

interface CmdbEquipment {
  id: string;
  type?: string;
  model?: string;
  building?: string | null;
  cabinet?: string | null;
}

interface CmdbLocation {
  id: string;
  kind: string;
  name: string;
  parentId: string | null;
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function requireUser(user: User | null): User {
  if (!user) throw httpError('Нужен вход', 401);
  return user;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function cmdbOf(data: ReferenceData): { equipment: CmdbEquipment[]; locations: CmdbLocation[] } {
  const cmdb = asRecord(data.extra.cmdb);
  const equipment = Array.isArray(cmdb.equipment)
    ? (cmdb.equipment as CmdbEquipment[]).filter((item) => typeof item.id === 'string')
    : [];
  const locations = Array.isArray(cmdb.locations) ? (cmdb.locations as CmdbLocation[]) : [];
  return { equipment, locations };
}

/** Подпись техники: «Принтер HP LaserJet Pro M404dn · каб. 312». */
export function equipmentLabel(item: CmdbEquipment, typeLabels: ReadonlyMap<string, string>): string {
  const kind = item.type ? (typeLabels.get(item.type) ?? item.type) : null;
  return [kind, item.model].filter(Boolean).join(' ') || item.id;
}

/** Корпус из названия локации CMDB: «Корпус Б» → «Б», «Промплощадка» → «ПРОМ» (код из CMDB и полей). */
export function buildingCode(name: string): string {
  const short = name.replace(/^Корпус\s+/i, '').trim();
  return /^пром/i.test(short) ? 'ПРОМ' : short;
}

/** Этаж по кабинету: «312» → «3»; не число — этаж неизвестен. */
export function floorOfCabinet(cabinet: string): string | null {
  const match = /^(\d)\d{2,}$/.exec(cabinet.trim());
  return match ? (match[1] ?? null) : null;
}

/** Профиль с новой основной техникой; время сохранения ставит хранилище. */
function freshProfile(profile: ApplicantProfile, equipmentId: string | null): ApplicantProfile {
  const { updatedAt: _updatedAt, ...rest } = profile;
  return { ...rest, equipmentId };
}

/** Id нового сотрудника: роль и короткий случайный хвост — читается в логах и не повторяется. */
export function newUserId(role: string, random: () => string = () => randomUUID().slice(0, 8)): string {
  return `u-${role}-${random()}`;
}

export function peopleRoutes(store: KernelStore, data: ReferenceData): RouteDef[] {
  const typeLabels = new Map(
    (data.dictionaries as DictionaryItem[])
      .filter((item) => item.dictionary === 'equipmentType')
      .map((item) => [item.code, item.label]),
  );

  return [
    {
      method: 'GET',
      url: '/api/profile/options',
      access: 'any',
      response: ProfileOptionsResponse,
      handler: async () => {
        const { equipment, locations } = cmdbOf(data);
        return {
          buildings: locations
            .filter((item) => item.kind === 'building')
            .map((item) => ({ code: buildingCode(item.name), label: item.name })),
          equipment: equipment.map((item) => ({
            id: item.id,
            label: equipmentLabel(item, typeLabels),
            building: item.building ?? null,
            cabinet: item.cabinet ?? null,
          })),
        };
      },
    },
    {
      method: 'PATCH',
      url: '/api/profile/place',
      access: 'any',
      body: ProfilePlaceInput,
      handler: async ({ body, user }) => {
        const actor = requireUser(user);
        const input = body as ProfilePlaceInput;
        const current = await store.getApplicantProfile(actor.id);
        const profile = {
          userId: actor.id,
          building: input.building,
          floor: floorOfCabinet(input.cabinet),
          cabinet: input.cabinet,
          equipmentId: current?.equipmentId ?? null,
        };
        await store.saveApplicantProfile(profile);
        return { profile: await store.getApplicantProfile(actor.id) };
      },
    },
    {
      method: 'POST',
      url: '/api/profile/equipment',
      access: 'any',
      body: ProfileEquipmentInput,
      handler: async ({ body, user }) => {
        const actor = requireUser(user);
        const input = body as ProfileEquipmentInput;
        const known = cmdbOf(data).equipment.find((item) => item.id === input.equipmentId);
        if (!known) throw httpError('Такой техники нет в учёте', 404);
        const item = {
          id: `aeq-${actor.id}-${known.id}`,
          userId: actor.id,
          equipmentId: known.id,
          note: input.note?.trim() || null,
        };
        await store.saveApplicantEquipment(item);
        // Первая техника становится основной: её помощник подставляет в обращение.
        const profile = await store.getApplicantProfile(actor.id);
        if (profile && !profile.equipmentId) {
          await store.saveApplicantProfile(freshProfile(profile, known.id));
        }
        return { item: { ...item, label: equipmentLabel(known, typeLabels) } };
      },
    },
    {
      // POST, а не DELETE: веб-клиент знает только get/post/patch.
      method: 'POST',
      url: '/api/profile/equipment/:id/remove',
      access: 'any',
      handler: async ({ params, user }) => {
        const actor = requireUser(user);
        const removed = await store.deleteApplicantEquipment(actor.id, params.id ?? '');
        if (!removed) throw httpError('Техника не найдена', 404);
        const profile = await store.getApplicantProfile(actor.id);
        const rest = await store.listApplicantEquipment(actor.id);
        if (profile && !rest.some((item) => item.equipmentId === profile.equipmentId)) {
          await store.saveApplicantProfile(freshProfile(profile, rest[0]?.equipmentId ?? null));
        }
        return { ok: true };
      },
    },
    {
      method: 'POST',
      url: '/api/users',
      access: 'settings',
      body: CreateUserInput,
      handler: async ({ body }) => {
        const input = body as CreateUserInput;
        const created: User = {
          id: newUserId(input.role),
          fullName: input.fullName,
          role: input.role,
          departmentId: input.departmentId ?? null,
          position: input.position,
        };
        await store.saveUser(created);
        if (input.building && input.cabinet) {
          await store.saveApplicantProfile({
            userId: created.id,
            building: input.building,
            floor: floorOfCabinet(input.cabinet),
            cabinet: input.cabinet,
            equipmentId: null,
          });
        }
        return { user: created };
      },
    },
    {
      method: 'PATCH',
      url: '/api/users/:id/role',
      access: 'settings',
      body: UpdateUserRoleInput,
      handler: async ({ params, body, user }) => {
        const actor = requireUser(user);
        const target = await store.getUser(params.id ?? '');
        if (!target) throw httpError('Сотрудник не найден', 404);
        if (target.id === actor.id) throw httpError('Свою роль поменять нельзя', 400);
        const { role } = body as UpdateUserRoleInput;
        const updated: User = { ...target, role };
        await store.saveUser(updated);
        return { user: updated };
      },
    },
  ];
}
