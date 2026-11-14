import type { KbGapsResult } from '../contracts';

/** Выгрузка О6 в CSV: BOM для Excel, разделитель `;`, десятичная запятая. Иные форматы — 400. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = ['Тема', 'Категория', 'Заявок', 'Доля без статьи, %', 'Пример заявки'] as const;

export const CSV_CATEGORY_HEADER = [
  'Категория',
  'Всего заявок',
  'Без статьи',
  'Доля, %',
  'Частая тема',
] as const;

export function buildCsv(result: KbGapsResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  for (const row of result.themes) {
    lines.push(
      [
        csvCell(row.label),
        csvCell(row.categoryLabel),
        csvCell(row.count),
        csvNumber(row.sharePercent),
        csvCell(row.exampleNumber),
      ].join(';'),
    );
  }
  lines.push('');
  lines.push(CSV_CATEGORY_HEADER.join(';'));
  for (const row of result.byCategory) {
    lines.push(
      [
        csvCell(row.label),
        csvCell(row.total),
        csvCell(row.withoutArticle),
        csvNumber(row.sharePercent),
        csvCell(row.topSymptom),
      ].join(';'),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
