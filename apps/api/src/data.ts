import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DictionariesFile, FieldsFile } from '@ugra/contracts';
import type { ReferenceData } from '@ugra/core';
import { createReferenceData } from '@ugra/core';
import { z } from 'zod';

const SettingsFile = z.object({ settings: z.record(z.string(), z.unknown()) });

async function readJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Загружает `data/*.json` и проверяет схемами контрактов. Отсутствующие файлы — пустые данные. */
export async function loadReferenceData(root = process.cwd()): Promise<ReferenceData> {
  const dir = join(root, 'data');
  const [fieldsRaw, dictionariesRaw, settingsRaw] = await Promise.all([
    readJson(join(dir, 'fields.json')),
    readJson(join(dir, 'dictionaries.json')),
    readJson(join(dir, 'settings.json')),
  ]);
  const fields = fieldsRaw ? FieldsFile.parse(fieldsRaw).fields : [];
  const dictionaries = dictionariesRaw ? DictionariesFile.parse(dictionariesRaw).items : [];
  const settings = settingsRaw ? SettingsFile.parse(settingsRaw).settings : {};
  const extra: Record<string, unknown> = {};
  const [cmdb, priorityMatrix, emergencyRules, engineers] = await Promise.all([
    readJson(join(dir, 'cmdb.json')),
    readJson(join(dir, 'priority-matrix.json')),
    readJson(join(dir, 'emergency-rules.json')),
    readJson(join(dir, 'engineers.json')),
  ]);
  if (cmdb) extra.cmdb = cmdb;
  if (priorityMatrix) extra.priorityMatrix = priorityMatrix;
  if (emergencyRules) extra.emergencyRules = emergencyRules;
  if (engineers) extra.engineers = engineers;
  return createReferenceData({ fields, dictionaries, settings, extra });
}
