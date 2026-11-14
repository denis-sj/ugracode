import type { DictionaryItem, FieldDef } from '@ugra/contracts';

/** Справочные данные приложения. Загружаются из `data/*.json` и проверяются схемами. */
export interface ReferenceData {
  fields: FieldDef[];
  dictionaries: DictionaryItem[];
  settings: Record<string, unknown>;
  /** Данные будущих задач (CMDB, специалисты, матрица приоритета) — без типизации в ядре. */
  extra: Record<string, unknown>;
}

export function createReferenceData(partial: Partial<ReferenceData> = {}): ReferenceData {
  return {
    fields: partial.fields ?? [],
    dictionaries: partial.dictionaries ?? [],
    settings: partial.settings ?? {},
    extra: partial.extra ?? {},
  };
}

export function settingNumber(data: ReferenceData, key: string, fallback: number): number {
  const raw = data.settings[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function dictionaryOptions(
  data: ReferenceData,
  name: string,
): { value: string; label: string }[] {
  return data.dictionaries
    .filter((item: DictionaryItem) => item.dictionary === name)
    .map((item) => ({ value: item.code, label: item.label }));
}

export function findField(data: ReferenceData, key: string): FieldDef | undefined {
  return data.fields.find((field) => field.key === key);
}
