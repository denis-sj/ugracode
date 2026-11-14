import type { CaseEvaluation, QualitySummary } from './metrics';
import { formatPercent, formatSeconds } from './metrics';
import type { CaseRun, EvalRun } from './run';

/**
 * Отчёт «эталон / ИИ» (раздел 5.3 харнесса). Владелец переносит таблицу на слайд,
 * поэтому она же печатается в консоль и пишется в `reports/quality.md`.
 */

export interface ReportRow {
  title: string;
  ideal: string;
  ai: string;
  threshold: string;
  passed: boolean;
  note?: string;
}

export function reportRows(summary: QualitySummary): ReportRow[] {
  return summary.evaluators.map((item) => ({
    title: item.title,
    ideal: item.ideal,
    ai: item.display,
    threshold: item.threshold,
    passed: item.passed,
    ...(item.note ? { note: item.note } : {}),
  }));
}

function mark(ok: boolean): string {
  return ok ? '✅' : '❌';
}

function markOptional(value: boolean | null): string {
  if (value === null) return '—';
  return value ? '✅' : '❌';
}

function fieldCell(item: CaseEvaluation): string {
  if (item.fields.total === 0) return '—';
  const base = `${item.fields.hits}/${item.fields.total} (${formatPercent(item.fields.rate)})`;
  return item.fields.fabricated.length > 0 ? `${base} +${item.fields.fabricated.length} выд.` : base;
}

function assigneeCell(item: CaseEvaluation): string {
  if (!item.assignee) return '—';
  if (item.assignee.top1) return 'топ-1';
  return item.assignee.top3 ? 'топ-3' : '❌';
}

function emergencyCell(item: CaseEvaluation): string {
  if (!item.emergency) return '—';
  if (item.emergency.miss) return '❌ пропуск';
  if (item.emergency.falseAlarm) return '❌ ложная';
  return '✅';
}

function caseRow(item: CaseRun): string {
  const evaluation = item.evaluation;
  return [
    `| ${evaluation.id} | ${fieldCell(evaluation)} | ${markOptional(evaluation.priority)} | ${emergencyCell(evaluation)} | ${assigneeCell(evaluation)} | ${markOptional(evaluation.article)} | ${markOptional(evaluation.question)} | ${evaluation.steps} | ${formatSeconds(evaluation.ms)} |`,
  ].join('');
}

function failureLines(item: CaseRun): string[] {
  const evaluation = item.evaluation;
  const lines: string[] = [];
  for (const outcome of evaluation.fields.outcomes) {
    if (outcome.hit) continue;
    lines.push(
      `поля · ${outcome.key}: эталон «${outcome.expected ?? '—'}», ИИ «${outcome.actual ?? '—'}» (${outcome.mode})`,
    );
  }
  for (const issue of evaluation.fields.fabricated) {
    lines.push(`выдуманное поле · ${issue.key} = «${issue.value}»: ${issue.reason}`);
  }
  if (evaluation.priority === false) lines.push('приоритет: не совпал с эталоном');
  if (evaluation.emergency?.miss) lines.push('авария: пропуск (в эталоне авария, система не заподозрила)');
  if (evaluation.emergency?.falseAlarm) lines.push('авария: ложная тревога');
  if (evaluation.assignee && !evaluation.assignee.top3) {
    lines.push(`исполнитель: эталон ${evaluation.assignee.expected.join(', ')}, ИИ ${evaluation.assignee.actual.join(', ') || '—'}`);
  }
  if (evaluation.article === false) lines.push('статья: нужной статьи нет среди выбранных');
  if (evaluation.question === false) lines.push('вопрос: спрошено не то поле');
  if (evaluation.trajectory && !evaluation.trajectory.ok) {
    const parts = [
      evaluation.trajectory.missing.length > 0 ? `не вызваны: ${evaluation.trajectory.missing.join(', ')}` : '',
      evaluation.trajectory.forbidden.length > 0 ? `запрещённые: ${evaluation.trajectory.forbidden.join(', ')}` : '',
      evaluation.trajectory.maxSteps !== null ? `шагов ${evaluation.trajectory.steps} из ${evaluation.trajectory.maxSteps}` : '',
    ].filter(Boolean);
    lines.push(`траектория: ${parts.join('; ')}`);
  }
  for (const error of evaluation.errors) lines.push(`шаг · ${error}`);
  return lines;
}

const CAVEATS: readonly string[] = [
  'Контрольный набор — 10 обращений (`testset/cases/`), это критерий К1. **На нём не настраиваем:**',
  'тексты, эталон и заглушки меняем только при явной ошибке в них.',
  'Настроечного набора `testset/dev/` (30–40 обращений) нет, поэтому цифры могут быть завышены:',
  'настройка по 10 примерам подгоняет ответы под них (раздел 5.1 харнесса).',
  'Пороги — наши, стартовые (раздел 5.2): после первого прогона они уточняются.',
  'Без эталона в кейсе оценщик показывает «—» и не считается провалом: это не «всё хорошо», а «не проверяли».',
];

function headerLines(run: EvalRun): string[] {
  const model =
    run.mode === 'cloud' ? `\`${run.model}\`, облако (Polza)` : 'заглушка модели (сценарии `testset/stubs`)';
  const duration = Math.max(
    0,
    new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
  );
  return [
    `| Прогон | ${run.startedAt} |`,
    `| Набор | контрольный \`testset/cases\` — ${run.summary.cases} обращений |`,
    `| Модель | ${model} |`,
    `| Длительность | ${formatSeconds(duration)} |`,
    `| Порогов выполнено | ${run.summary.met} из ${run.summary.withThreshold} |`,
    `| Шагов с ошибкой | ${run.summary.failedSteps} |`,
  ];
}

/** Полный отчёт: шапка, таблица «эталон / ИИ», кейсы, провалы, оговорки. */
export function renderQualityReport(run: EvalRun): string {
  const summary = run.summary;
  const lines: string[] = [
    '# Качество разбора: эталон / ИИ',
    '',
    'Сгенерировано `pnpm eval` — тот же движок и тот же набор, что в демо.',
    '',
    '| | |',
    '|---|---|',
    ...headerLines(run),
    '',
    '## Таблица «эталон / ИИ»',
    '',
    '| Оценщик | Эталон | ИИ | Порог | Итог |',
    '|---|---|---|---|---|',
    ...reportRows(summary).map(
      (row) =>
        `| ${row.title}${row.note ? ` _(${row.note})_` : ''} | ${row.ideal} | ${row.ai} | ${row.threshold} | ${mark(row.passed)} |`,
    ),
    '',
    summary.unmet.length === 0
      ? 'Все пороги выполнены.'
      : `Не выполнено порогов: ${summary.unmet.length} — ${summary.unmet.map((item) => item.title.toLowerCase()).join(', ')}.`,
    '',
    '## По обращениям',
    '',
    '| Кейс | Поля | Приоритет | Авария | Исполнитель | Статья | Вопрос | Шагов | Время |',
    '|---|---|---|---|---|---|---|---|---|',
    ...run.cases.map(caseRow),
    '',
  ];

  const failures = run.cases
    .map((item) => ({ id: item.evaluation.id, lines: failureLines(item) }))
    .filter((item) => item.lines.length > 0);
  lines.push('## Провалы по оценщикам', '');
  if (failures.length === 0) {
    lines.push('Провалов нет.');
  } else {
    for (const failure of failures) {
      lines.push(`### ${failure.id}`, '', ...failure.lines.map((line) => `- ${line}`), '');
    }
  }

  if (run.skipped.length > 0) {
    lines.push('## Пропущенные файлы набора', '');
    for (const item of run.skipped) lines.push(`- \`${item.file}\` — ${item.error}`);
    lines.push('');
  }

  if (run.mode === 'stub') {
    lines.push(
      '## Сценарии заглушки',
      '',
      '- Сценарий — записанный ответ из `testset/stubs/NN.json`, приведённый к `submit` агента `intake`.',
      '- Если в записи есть поля без цитаты, `check()` агента её отклоняет: второй ход повторяет `submit` без',
      '  таких полей (как исправление модели по ошибке проверки). Поэтому `department`, `impact`, `urgency`',
      '  без цитаты в прогон не попадают — это расхождение записи и проверок, а не ошибка оценщика.',
      '- Время в этом режиме ничего не говорит о модели: сценарий отвечает мгновенно, цена не считается.',
      '',
    );
  }

  const warnings = [...run.warnings, ...run.cases.flatMap((item) => item.warnings)];
  if (warnings.length > 0) {
    lines.push('## Предупреждения прогона', '');
    for (const warning of [...new Set(warnings)]) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Оговорки', '', ...CAVEATS.map((line) => `- ${line}`), '');
  return lines.join('\n');
}

/** Таблица для консоли: те же строки, без markdown. */
export function renderConsole(run: EvalRun): string {
  const rows = reportRows(run.summary);
  const titleWidth = Math.max(...rows.map((row) => row.title.length), 'Оценщик'.length);
  const pad = (text: string, width: number): string => text.padEnd(width, ' ');
  const lines = [
    `${pad('Оценщик', titleWidth)}  эталон  ИИ      порог   итог`,
    `${'-'.repeat(titleWidth)}  ------  ------  ------  -------`,
    ...rows.map(
      (row) =>
        `${pad(row.title, titleWidth)}  ${pad(row.ideal, 6)}  ${pad(row.ai, 6)}  ${pad(row.threshold, 6)}  ${row.passed ? 'ok' : 'НЕ ВЫПОЛНЕНО'}`,
    ),
  ];
  if (run.summary.unmet.length > 0) {
    lines.push('', `Не выполнено порогов: ${run.summary.unmet.length}`);
    for (const item of run.summary.unmet) lines.push(`- ${item.title}: ${item.display} (порог ${item.threshold})`);
  } else {
    lines.push('', 'Все пороги выполнены.');
  }
  if (run.summary.failedSteps > 0) {
    lines.push(`Шагов с ошибкой: ${run.summary.failedSteps} — см. трассировку кейса (--case NN).`);
  }
  return lines.join('\n');
}

export { CAVEATS };
