import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { PriorityLevel } from '@ugra/contracts';
import { defineModule } from '@ugra/core';
import type { ReferenceData, SeedDeps } from '@ugra/core';
import {
  generateHistory,
  HISTORY_SEED_THRESHOLD,
  type HistoryEngineer,
  type HistoryEquipment,
  type HistorySeedInput,
  type HistoryUser,
} from './generator';

/**
 * Модуль `history-seed` — синтетическая история заявок за 6 месяцев (задача 015).
 *
 * Своих таблиц нет: пишет в таблицы ядра через `KernelStore`. Флаг по умолчанию выключен,
 * потому что это демо-данные, а не фича; для демо включается `FEATURES_ON=history-seed`.
 */

const DATA_URL = new URL('../../../data/', import.meta.url);

const UsersFile = z.object({
  users: z.array(
    z.object({
      id: z.string().min(1),
      fullName: z.string().min(1),
      role: z.string().min(1),
    }),
  ),
});

const EngineersFile = z.object({
  engineers: z.array(
    z.object({
      id: z.string().min(1),
      fullName: z.string().min(1),
      departmentId: z.string().nullable(),
      skills: z.array(z.object({ skill: z.string(), level: z.number() })),
      buildings: z.array(z.string()),
    }),
  ),
});

const EquipmentFile = z.object({
  equipment: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      model: z.string().min(1),
      building: z.string().min(1),
      cabinet: z.string().min(1),
    }),
  ),
});

const DictionariesFile = z.object({
  items: z.array(
    z.object({
      dictionary: z.string().min(1),
      code: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
});

const PriorityMatrixFile = z.object({
  levels: z.record(z.string(), z.object({ slaMinutes: z.number().int().positive() })),
});

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

/** Категории и корпуса: справочники из ссылочных данных, иначе из `data/dictionaries.json`. */
function referenceValues(data: ReferenceData): { categories: string[]; buildings: string[] } {
  if (data.dictionaries.length > 0) {
    const categories = data.dictionaries
      .filter((item) => item.dictionary === 'category')
      .map((item) => item.code);
    const buildings = data.dictionaries
      .filter((item) => item.dictionary === 'building')
      .map((item) => item.code);
    if (categories.length > 0 && buildings.length > 0) return { categories, buildings };
  }
  const parsed = DictionariesFile.parse(readJson(new URL('dictionaries.json', DATA_URL)));
  return {
    categories: parsed.items.filter((item) => item.dictionary === 'category').map((item) => item.code),
    buildings: parsed.items.filter((item) => item.dictionary === 'building').map((item) => item.code),
  };
}

function readEquipment(data: ReferenceData): HistoryEquipment[] {
  const extra = data.extra['cmdb'];
  const fromExtra = EquipmentFile.safeParse(extra);
  const parsed = fromExtra.success
    ? fromExtra.data
    : EquipmentFile.parse(readJson(new URL('cmdb.json', DATA_URL)));
  return parsed.equipment.map((item) => ({
    id: item.id,
    type: item.type,
    model: item.model,
    building: item.building,
    cabinet: item.cabinet,
  }));
}

function readSlaMinutes(data: ReferenceData): Partial<Record<PriorityLevel, number>> {
  const extra = data.extra['priorityMatrix'];
  const fromExtra = PriorityMatrixFile.safeParse(extra);
  const levels = fromExtra.success
    ? fromExtra.data.levels
    : PriorityMatrixFile.parse(readJson(new URL('priority-matrix.json', DATA_URL))).levels;
  const result: Partial<Record<PriorityLevel, number>> = {};
  for (const [key, value] of Object.entries(levels)) {
    result[key as PriorityLevel] = value.slaMinutes;
  }
  return result;
}

/** Собирает вход генератора: пользователи, инженеры, техника и справочники. */
export function buildHistoryInput(data: ReferenceData, now: Date): HistorySeedInput {
  const users: HistoryUser[] = UsersFile.parse(readJson(new URL('users.json', DATA_URL)))
    .users.filter((user) => user.role === 'applicant')
    .map((user) => ({ id: user.id, fullName: user.fullName }));

  const engineers: HistoryEngineer[] = EngineersFile.parse(
    readJson(new URL('engineers.json', DATA_URL)),
  ).engineers.map((engineer) => ({
    id: engineer.id,
    fullName: engineer.fullName,
    departmentId: engineer.departmentId,
    skills: engineer.skills.map((skill) => skill.skill),
    buildings: engineer.buildings,
  }));

  const { categories, buildings } = referenceValues(data);

  return {
    now,
    count: 600,
    months: 6,
    seed: 20261114,
    users,
    engineers,
    equipment: readEquipment(data),
    categories,
    buildings,
    slaMinutes: readSlaMinutes(data),
  };
}

export default defineModule({
  id: 'history-seed',
  title: 'История заявок за 6 месяцев',
  enabledByDefault: false,
  async seed({ db, data, clock }: SeedDeps) {
    const existing = await db.listTickets({ limit: 1000 });
    if (existing.length >= HISTORY_SEED_THRESHOLD) {
      console.info(
        `history-seed: в базе уже ${existing.length} заявок — история не дублируется`,
      );
      return;
    }

    const input = buildHistoryInput(data, clock.now());
    if (input.engineers.length === 0 || input.equipment.length === 0) {
      console.info('history-seed: нет инженеров или техники — история не сгенерирована');
      return;
    }

    const generated = generateHistory(input);
    for (const item of generated.tickets) {
      await db.saveAppeal(item.appeal);
      await db.saveTicket(item.ticket);
      await db.saveTicketFields(item.ticket.id, item.fields);
      await db.appendEvent(item.event);
    }

    console.info(
      `history-seed: записано ${generated.tickets.length} заявок за ${input.months ?? 6} месяцев`,
    );
  },
});
