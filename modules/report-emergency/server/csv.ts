import type { EmergencyResult } from '../contracts';

/** Выгрузка О7 в CSV: BOM для Excel, разделитель `;`, десятичная запятая. Иные форматы — 400. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = ['Раздел', 'Показатель', 'Значение'] as const;

export function buildCsv(result: EmergencyResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  const push = (section: string, label: string, value: string | number | null): void => {
    lines.push([csvCell(section), csvCell(label), csvCell(value)].join(';'));
  };
  const summary = result.summary;

  push('Сводка', 'Период, дней', result.period.days);
  push('Сводка', 'Заявок за период', summary.total);
  push('Сводка', 'Аварий', summary.emergency);
  push('Сводка', 'Доля аварий, %', csvNumber(summary.sharePercent));
  push('Сводка', 'Аварий закрыто', summary.closed);
  push('Сводка', 'Аварий открыто', summary.open);
  push('Сводка', 'Реакция измерена по авариям', summary.reactionMeasured);
  push('Сводка', 'Среднее время реакции, мин', csvNumber(summary.avgReactionMinutes));
  push('Сводка', 'Повторных точек', summary.repeatedHotspots);
  push('Сводка', 'Сигналов аварии', summary.detectedSignals);
  push('Сводка', 'Ложных тревог', summary.falseAlarms === null ? null : summary.falseAlarms);

  for (const row of result.hotspots) {
    push('Повторные аварии', row.label, row.count);
  }
  for (const ticket of result.recent) {
    push('Последние аварии', ticket.number, ticket.createdAt);
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
