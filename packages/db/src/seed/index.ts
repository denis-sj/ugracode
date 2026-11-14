import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  createReferenceData,
  resolveEnabledModules,
  type SeedDeps,
  type ServerModule,
} from '@ugra/core';
import { runMigrations } from '../migrate';
import { createPgStore, DEFAULT_DATABASE_URL } from '../pg-store';
import {
  cmdbEquipmentTable,
  cmdbLocationTable,
  dictionaryItemTable,
  dutyShiftTable,
  engineerProfileTable,
  engineerSkillTable,
  fieldDefTable,
  kbArticleTable,
  schema,
  settingTable,
  userTable,
} from '../schema';
import { loadSeedData, mergeLocations } from './load-data';

/** Демо-таблицы для `--reset`. `event_log` не трогаем: журнал только на добавление. */
const RESET_TABLES = [
  'ticket_field',
  'ticket',
  'appeal_message',
  'appeal',
  'pipeline_step',
  'pipeline_run',
  'notification',
  'ai_cache',
  'engineer_skill',
  'engineer_profile',
  'duty_shift',
  'kb_article',
  'cmdb_equipment',
  'cmdb_location',
  'dictionary_item',
  'field_def',
  'setting',
  '"user"',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isServerModule(value: unknown): value is ServerModule {
  return isRecord(value) && typeof value.id === 'string';
}

function pickModuleList(loaded: unknown): unknown[] {
  if (!isRecord(loaded)) return [];
  for (const key of ['modules', 'serverModules', 'default']) {
    const value = loaded[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Реестр модулей пишет другой агент; пока файла нет — сид работает без модулей. */
async function loadEnabledModules(): Promise<ServerModule[]> {
  const url = new URL('../../../../modules/registry.server.ts', import.meta.url);
  if (!existsSync(fileURLToPath(url))) {
    console.log('Реестр модулей не найден — сид без модулей');
    return [];
  }
  try {
    const loaded: unknown = await import(url.href);
    const modules = pickModuleList(loaded).filter(isServerModule);
    const { enabled } = resolveEnabledModules(modules, {
      FEATURES_OFF: process.env.FEATURES_OFF,
      FEATURES_ON: process.env.FEATURES_ON,
    });
    return enabled;
  } catch (error) {
    console.warn('Не удалось загрузить реестр модулей:', error);
    return [];
  }
}

/** Загружает базовые демо-данные. Идемпотентно: повторный запуск не плодит дубли. */
export async function seed(options: { reset?: boolean } = {}): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  await runMigrations(connectionString);

  const data = loadSeedData();
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    if (options.reset) {
      await pool.query(`TRUNCATE TABLE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
      console.log('Демо-таблицы очищены, event_log сохранён');
    }

    // Пользователей из data/users.json не перезаписываем: правки в интерфейсе важнее сида.
    for (const user of data.users) {
      await db
        .insert(userTable)
        .values({
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          departmentId: user.departmentId,
          position: user.position,
        })
        .onConflictDoNothing({ target: userTable.id });
    }

    for (const field of data.fields) {
      const def = { ...field } as Record<string, unknown>;
      await db
        .insert(fieldDefTable)
        .values({ key: field.key, def, moduleId: field.moduleId ?? null })
        .onConflictDoUpdate({
          target: fieldDefTable.key,
          set: { def, moduleId: field.moduleId ?? null },
        });
    }

    for (const item of data.dictionaries) {
      const row = {
        dictionary: item.dictionary,
        code: item.code,
        label: item.label,
        parentCode: item.parentCode ?? null,
        meta: item.meta ?? null,
      };
      await db
        .insert(dictionaryItemTable)
        .values(row)
        .onConflictDoUpdate({
          target: [dictionaryItemTable.dictionary, dictionaryItemTable.code],
          set: { label: row.label, parentCode: row.parentCode, meta: row.meta },
        });
    }

    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(data.settings)) {
      await db
        .insert(settingTable)
        .values({ key, value, updatedAt: now })
        // Настройки, изменённые в интерфейсе, сид не перезаписывает.
        .onConflictDoNothing({ target: settingTable.key });
    }

    for (const location of mergeLocations(data.cmdb.locations, data.cmdb.equipment)) {
      await db
        .insert(cmdbLocationTable)
        .values(location)
        .onConflictDoUpdate({
          target: cmdbLocationTable.id,
          set: { kind: location.kind, name: location.name, parentId: location.parentId },
        });
    }

    for (const item of data.cmdb.equipment) {
      const row = {
        id: item.id,
        type: item.type,
        model: item.model,
        serial: item.serial ?? null,
        inventoryNo: item.inventoryNo ?? null,
        ip: item.ip ?? null,
        building: item.building,
        cabinet: item.cabinet,
        criticality: item.criticality,
      };
      await db
        .insert(cmdbEquipmentTable)
        .values(row)
        .onConflictDoUpdate({
          target: cmdbEquipmentTable.id,
          set: {
            type: row.type,
            model: row.model,
            serial: row.serial,
            inventoryNo: row.inventoryNo,
            ip: row.ip,
            building: row.building,
            cabinet: row.cabinet,
            criticality: row.criticality,
          },
        });
    }

    for (const engineer of data.engineers) {
      const profile = {
        userId: engineer.id,
        department: engineer.departmentId,
        level: engineer.level,
        buildings: engineer.buildings,
        onDuty: engineer.onShift,
        status: engineer.onShift ? 'available' : 'off_shift',
      };
      await db
        .insert(engineerProfileTable)
        .values(profile)
        .onConflictDoUpdate({
          target: engineerProfileTable.userId,
          set: {
            department: profile.department,
            level: profile.level,
            buildings: profile.buildings,
            onDuty: profile.onDuty,
            status: profile.status,
          },
        });

      for (const skill of engineer.skills) {
        await db
          .insert(engineerSkillTable)
          .values({ userId: engineer.id, skill: skill.skill, level: skill.level })
          .onConflictDoUpdate({
            target: [engineerSkillTable.userId, engineerSkillTable.skill],
            set: { level: skill.level },
          });
      }

      // Смены не имеют бизнес-ключа: пересоздаём смену инженера, чтобы повторный сид не дублировал.
      await db.delete(dutyShiftTable).where(eq(dutyShiftTable.userId, engineer.id));
      if (engineer.onShift) {
        await db.insert(dutyShiftTable).values({
          userId: engineer.id,
          kind: 'shift',
          startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          endsAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    for (const article of data.kbArticles) {
      const row = {
        id: article.id,
        title: article.title,
        symptoms: article.symptoms,
        steps: article.steps,
        solution: article.solution,
        category: article.category,
      };
      await db
        .insert(kbArticleTable)
        .values({ ...row, embedding: null })
        // Эмбеддинг не трогаем: он может быть посчитан при старте.
        .onConflictDoUpdate({ target: kbArticleTable.id, set: row });
    }

    const onShift = data.engineers.filter((engineer) => engineer.onShift).length;
    console.log(
      `Базовые данные: ${data.users.length} пользователей, ${data.engineers.length} инженеров ` +
        `(${onShift} на смене), ${data.fields.length} полей, ${data.dictionaries.length} справочников, ` +
        `${data.cmdb.equipment.length} единиц оборудования, ${data.kbArticles.length} статей`,
    );
  } finally {
    await pool.end();
  }

  const modules = await loadEnabledModules();
  if (modules.length === 0) return;

  const handle = createPgStore(connectionString);
  try {
    const seedDeps: SeedDeps = {
      db: handle.store,
      data: createReferenceData({
        fields: data.fields,
        dictionaries: data.dictionaries,
        settings: data.settings,
        extra: {
          cmdb: data.cmdb,
          priorityMatrix: data.priorityMatrix,
          emergencyRules: data.emergencyRules,
        },
      }),
      clock: { now: () => new Date() },
    };
    for (const module of modules) {
      if (!module.seed) continue;
      try {
        await module.seed(seedDeps);
        console.log(`Модуль ${module.id}: данные загружены`);
      } catch (error) {
        console.warn(`Модуль ${module.id}: сид упал:`, error);
      }
    }
  } finally {
    await handle.close();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  seed({ reset: process.argv.includes('--reset') })
    .then(() => {
      console.log('Сид выполнен');
    })
    .catch((error: unknown) => {
      console.error('Ошибка сида:', error);
      process.exitCode = 1;
    });
}
