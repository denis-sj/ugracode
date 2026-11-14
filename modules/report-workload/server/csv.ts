import type { WorkloadResult } from '../contracts';

/** Выгрузка О4 в CSV: BOM для Excel, разделитель `;`, десятичная запятая. Иные форматы — 400. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = [
  'Исполнитель',
  'Подразделение',
  'Открыто',
  'Закрыто',
  'Всего',
  'Среднее решение, мин',
  'Перегруз',
] as const;

export const CSV_DEPARTMENT_HEADER = [
  'Подразделение',
  'Инженеров',
  'Открыто',
  'Закрыто',
  'Доля открытых, %',
  'Открытых на инженера',
  'Перегружено',
] as const;

export function buildCsv(result: WorkloadResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  for (const row of result.byEngineer) {
    lines.push(
      [
        csvCell(row.name),
        csvCell(row.departmentLabel),
        csvCell(row.open),
        csvCell(row.closed),
        csvCell(row.total),
        csvNumber(row.avgResolutionMinutes),
        row.overload ? 'да' : 'нет',
      ].join(';'),
    );
  }
  lines.push('');
  lines.push(CSV_DEPARTMENT_HEADER.join(';'));
  for (const row of result.byDepartment) {
    lines.push(
      [
        csvCell(row.label),
        csvCell(row.engineers),
        csvCell(row.open),
        csvCell(row.closed),
        csvNumber(row.openSharePercent),
        csvNumber(row.avgOpenPerEngineer),
        csvCell(row.overloadedEngineers),
      ].join(';'),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
