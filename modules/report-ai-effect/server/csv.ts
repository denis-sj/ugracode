import type { AiEffectResult } from '../contracts';

/** Выгрузка О5 в CSV: BOM для Excel, разделитель `;`. Другие форматы маршрут отклоняет с 400. */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvNumber(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export const CSV_HEADER = ['Показатель', 'Значение'] as const;

export function buildCsv(result: AiEffectResult): string {
  const lines: string[] = [CSV_HEADER.join(';')];
  const push = (label: string, value: string | number | null): void => {
    lines.push([csvCell(label), csvCell(value)].join(';'));
  };

  push('Период, дней', result.period.days);
  push('Заявок с подсказками ИИ', result.totals.ticketsWithAi);
  push('Полей предложено ИИ', result.totals.fieldsSuggested);
  push('Полей исправлено человеком', result.totals.fieldsCorrected);
  push('Заявок без правок', result.totals.ticketsWithoutEdits);
  push('Без правок, %', csvNumber(result.totals.shareWithoutEditsPercent));
  push('Среднее число правок на заявку', csvNumber(result.totals.avgCorrectionsPerTicket));
  push('Среднее время до подтверждения, мин', csvNumber(result.totals.avgMinutesToConfirm));
  push('Подтверждённых заявок', result.totals.confirmedTickets);
  push(
    'Замеров ручного режима',
    result.comparison.withoutAi === null ? 'нет данных' : result.comparison.withoutAi.tickets,
  );
  for (const row of result.totals.correctionsByField) {
    push(`Поле: ${row.label}`, row.corrections);
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
