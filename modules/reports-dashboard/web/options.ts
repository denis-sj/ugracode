/** Справочники фильтров и меню выгрузки: чистые данные без React. */

import type { MetaResponse } from '@ugra/contracts';
import type { OverviewResult, OverviewSlice } from '../contracts';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FilterOptions {
  categories: SelectOption[];
  buildings: SelectOption[];
  channels: SelectOption[];
  statuses: SelectOption[];
  assignees: SelectOption[];
}

export interface ExportItem {
  label: string;
  hint: string;
  /** Маршрутов выгрузки на сервере пока нет — все пункты выключены. */
  disabled: boolean;
  title: string;
}

/** Подпись для выключенных пунктов выгрузки (задача 015, отчёты О1–О8). */
export const EXPORT_DISABLED_HINT = 'появится с отчётами О1–О8';

export const EXPORT_ITEMS: readonly ExportItem[] = [
  {
    label: 'Excel (.xlsx)',
    hint: 'все разрезы, по листам',
    disabled: true,
    title: `Excel — ${EXPORT_DISABLED_HINT}`,
  },
  {
    label: 'PDF-отчёт',
    hint: 'с выводами, для печати',
    disabled: true,
    title: `PDF-отчёт — ${EXPORT_DISABLED_HINT}`,
  },
  {
    label: 'CSV',
    hint: 'сырые заявки периода',
    disabled: true,
    title: `CSV — ${EXPORT_DISABLED_HINT}`,
  },
  {
    label: 'Отправить на почту',
    hint: 'сейчас',
    disabled: true,
    title: `Отправка на почту — ${EXPORT_DISABLED_HINT}`,
  },
  {
    label: 'Присылать сводку',
    hint: 'каждый понедельник',
    disabled: true,
    title: `Сводка по понедельникам — ${EXPORT_DISABLED_HINT}`,
  },
];

const FALLBACK_CHANNELS: readonly SelectOption[] = [
  { value: 'chat', label: 'Чат' },
  { value: 'phone', label: 'Телефон' },
  { value: 'email', label: 'Электронная почта' },
  { value: 'screenshot', label: 'Скриншот' },
];

/** Статусы контракта `OverviewFilters` — подписи как в очереди и журнале. */
export const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: 'new', label: 'Новая' },
  { value: 'ai_draft', label: 'Черновик ИИ' },
  { value: 'waiting_applicant', label: 'Ждёт заявителя' },
  { value: 'in_review', label: 'На проверке' },
  { value: 'assigned', label: 'Назначена' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решена' },
  { value: 'closed', label: 'Закрыта' },
  { value: 'cancelled', label: 'Отменена' },
];

export function dictionaryOptions(
  meta: Pick<MetaResponse, 'dictionaries'> | null | undefined,
  dictionary: string,
): SelectOption[] {
  if (!meta) return [];
  return meta.dictionaries
    .filter((item) => item.dictionary === dictionary)
    .map((item) => ({ value: item.code, label: item.label }));
}

export function slicesToOptions(slices: readonly OverviewSlice[]): SelectOption[] {
  return slices.map((slice) => ({ value: slice.key, label: slice.label }));
}

/** Добавляет новые значения к уже показанным, чтобы выбранный фильтр не исчезал из списка. */
export function mergeOptions(
  previous: readonly SelectOption[],
  next: readonly SelectOption[],
): SelectOption[] {
  const merged = new Map(previous.map((option) => [option.value, option] as const));
  for (const option of next) merged.set(option.value, option);
  return [...merged.values()];
}

/**
 * Наборы для селектов: категории и корпуса — из `/api/meta` (справочники),
 * исполнители — из разреза ответа (в meta их нет), каналы — из meta с запасным списком.
 */
export function buildFilterOptions(
  meta: Pick<MetaResponse, 'dictionaries'> | null | undefined,
  data: OverviewResult | null,
  assignees: readonly SelectOption[] = [],
): FilterOptions {
  const categoryFallback = data ? slicesToOptions(data.byCategory) : [];
  const buildingFallback = data ? slicesToOptions(data.byBuilding) : [];
  const metaChannels = dictionaryOptions(meta, 'channel');

  return {
    categories: mergeOptions(dictionaryOptions(meta, 'category'), categoryFallback),
    buildings: mergeOptions(dictionaryOptions(meta, 'building'), buildingFallback),
    channels: metaChannels.length > 0 ? metaChannels : [...FALLBACK_CHANNELS],
    statuses: [...STATUS_OPTIONS],
    assignees: [...assignees],
  };
}
