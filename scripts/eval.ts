import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderConsole, renderQualityReport } from '../modules/quality/server/report';
import { evalReportJson, runEval } from '../modules/quality/server/run';

/**
 * `pnpm eval [--model <id>] [--cloud] [--case NN]` — оценка качества разбора.
 *
 * Пишет `reports/quality.md` (таблица «эталон / ИИ» — её владелец переносит на слайд)
 * и `reports/eval-<дата-время>.json` (полные траектории). Код выхода 0, даже если
 * пороги не выполнены: провал порога — это результат прогона, а не ошибка запуска.
 */

interface CliOptions {
  model?: string;
  caseId?: string;
  cloud: boolean;
  help: boolean;
}

const HELP = [
  'pnpm eval [ключи]',
  '',
  '  --model <id>   сравнить модель: прогон через Polza с этой моделью (LLM_MODEL_MAIN)',
  '  --cloud        прогон через Polza с моделью из окружения',
  '  --case NN      один кейс (04, 04-network-… или case-04) с трассировкой шагов',
  '  --help, -h     эта подсказка',
  '',
  'Без ключей — контрольный набор через записанные сценарии (testset/stubs).',
].join('\n');

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { cloud: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? '';
    const [flag = '', inline] = raw.split('=', 2);
    const value = (): string => {
      const found = inline ?? argv[index + 1];
      if (!found || found.startsWith('--')) throw new Error(`не задано значение для ${flag}`);
      if (inline === undefined) index += 1;
      return found;
    };
    switch (flag) {
      case '--model':
        options.model = value();
        break;
      case '--case':
        options.caseId = value();
        break;
      case '--cloud':
        options.cloud = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`неизвестный ключ «${flag}»`);
    }
  }
  return options;
}

/** Имя файла траекторий: `2026-11-14T10-00-00-000Z` — без двоеточий, годится для macOS и Linux. */
export function reportStamp(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-');
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    console.info(HELP);
    return 0;
  }

  const run = await runEval({ model: options.model, caseId: options.caseId, cloud: options.cloud });

  console.info(renderConsole(run));
  if (options.caseId) {
    for (const item of run.cases) {
      console.info(
        ['', `Кейс ${item.evalCase.id}: ${item.evalCase.text}`, '', ...item.trace].join('\n'),
      );
    }
  }

  const reportsDir = join(process.cwd(), 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const markdownPath = join(reportsDir, 'quality.md');
  const jsonPath = join(reportsDir, `eval-${reportStamp(run.startedAt)}.json`);
  writeFileSync(markdownPath, renderQualityReport(run), 'utf8');
  writeFileSync(jsonPath, evalReportJson(run), 'utf8');

  console.info('');
  const model = run.mode === 'cloud' ? run.model : 'заглушка (сценарии)';
  console.info(`Модель: ${model}, порогов выполнено ${run.summary.met} из ${run.summary.withThreshold}`);
  console.info(`Отчёт: ${markdownPath}`);
  console.info(`Траектории: ${jsonPath}`);
  return 0;
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('eval.ts') || entry.endsWith('eval.js')) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
