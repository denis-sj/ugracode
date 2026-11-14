import type { HotspotsResult } from '../contracts';

/** Выгрузка О2 в CSV: BOM для Excel, разделитель `;`, десятичная запятая. Если PDF/иное — 400 на маршруте. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = [
  'Корпус',
  'Кабинет',
  'Точка',
  'Тип',
  'Число заявок',
  'Доля, %',
  'Среднее решение, мин',
  'Прошлый период',
  'Тренд, %',
] as const;

export function buildCsv(result: HotspotsResult): string {
  const lines = [CSV_HEADER.join(';')];
  for (const row of result.rows) {
    lines.push(
      [
        csvCell(row.building),
        csvCell(row.cabinet),
        csvCell(row.label),
        row.kind === 'equipment' ? 'Оборудование' : 'Кабинет',
        csvCell(row.count),
        csvNumber(row.sharePercent),
        csvNumber(row.avgResolutionMinutes),
        csvCell(row.previousCount),
        csvNumber(row.trendPercent),
      ].join(';'),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
