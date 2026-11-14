import type { SlaResult } from '../contracts';

/** Выгрузка О3 в CSV: BOM для Excel, разделитель `;`, десятичная запятая. Иные форматы — 400 на маршруте. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = ['Раздел', 'Показатель', 'Значение'] as const;

export function buildCsv(result: SlaResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  const push = (section: string, label: string, value: string | number | null): void => {
    lines.push([csvCell(section), csvCell(label), csvCell(value)].join(';'));
  };
  const summary = result.summary;

  push('Сводка', 'Период, дней', result.period.days);
  push('Сводка', 'Заявок за период', summary.total);
  push('Сводка', 'Закрыто', summary.closed);
  push('Сводка', 'Открыто', summary.open);
  push('Сводка', 'Отменено', summary.cancelled);
  push('Сводка', 'В срок закрыто, %', csvNumber(summary.slaOnTimePercent));
  push('Сводка', 'Закрыто с просрочкой', summary.lateClosed);
  push('Сводка', 'Открытых просрочено', summary.openOverdue);
  push('Сводка', 'Под риском', summary.atRisk);
  push('Сводка', 'Средняя просрочка закрытых, мин', csvNumber(summary.avgLateMinutes));
  push('Сводка', 'Среднее время реакции, мин', csvNumber(summary.avgReactionMinutes));
  push('Сводка', 'Среднее время решения, мин', csvNumber(summary.avgResolutionMinutes));
  push('Сводка', 'Реакция в срок, %', csvNumber(summary.reactionOnTimePercent));

  for (const row of result.byPriority) {
    push('Приоритет', `${row.label}: заявок`, row.total);
    push('Приоритет', `${row.label}: нарушений`, row.breaches);
    push('Приоритет', `${row.label}: в срок, %`, csvNumber(row.onTimePercent));
  }
  for (const row of result.byDepartment) {
    push('Подразделение', `${row.label}: заявок`, row.total);
    push('Подразделение', `${row.label}: нарушений`, row.breaches);
    push('Подразделение', `${row.label}: в срок, %`, csvNumber(row.onTimePercent));
  }
  for (const ticket of result.worst) {
    push('Худшие заявки', ticket.number, ticket.lateMinutes);
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
