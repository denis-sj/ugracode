import type { ShiftResult } from '../contracts';

/** Выгрузка О1 в CSV: BOM для Excel, разделитель `;`. Другие форматы маршрут отклоняет с 400. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = ['Раздел', 'Показатель', 'Значение'] as const;

export function buildCsv(result: ShiftResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  const push = (section: string, label: string, value: string | number | null): void => {
    lines.push([csvCell(section), csvCell(label), csvCell(value)].join(';'));
  };

  push('Смена', 'Дата', result.period.date);
  push('Смена', 'Всего заявок', result.totals.total);
  push('Смена', 'Новых', result.totals.created);
  push('Смена', 'Закрытых', result.totals.closed);
  push('Смена', 'Аварий', result.totals.emergency);
  push('Смена', 'Нарушений срока', result.totals.slaBreaches);
  push('Смена', 'В срок, %', csvNumber(result.totals.slaOnTimePercent));
  push('Внимание', 'Просрочено', result.attention.overdueCount);
  push('Внимание', 'Ждут проверки', result.attention.waitingReviewCount);

  for (const row of result.byAssignee) {
    push('Исполнитель', row.name, row.total);
  }
  for (const ticket of result.attention.overdue) {
    push('Просроченные', ticket.number, ticket.status);
  }
  for (const ticket of result.attention.waitingReview) {
    push('Ждут проверки', ticket.number, ticket.status);
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
