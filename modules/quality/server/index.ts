import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineModule } from '@ugra/core';
import { QUALITY_CASE_LIMIT, QUALITY_RUN_TIMEOUT_MS, QualityReport, QualityRunRequest } from '../contracts';
import {
  applyCaseTitles,
  emptyReport,
  parseQualityReport,
  reportFromRun,
  unreadableReport,
} from './report-data';

/**
 * Модуль `quality` — оценщик качества разбора (задача 014) и экран «Качество ИИ» (К2).
 *
 * Шагов, инструментов и агентов у модуля нет: он не участвует в разборе обращения.
 * `pnpm eval` гоняет контрольный набор и пишет `reports/quality.md`;
 * `GET /api/m/quality/report` читает этот отчёт, `POST /api/m/quality/run` гоняет
 * набор заново в режиме заглушки (без сети) и возвращает ту же структуру.
 */

/** Один прогон за раз: повторное нажатие не запускает второй движок параллельно. */
let running = false;

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function reportPath(): string {
  return resolve(process.cwd(), 'reports/quality.md');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

/** Тексты обращений набора: только заголовки для строк отчёта, ошибки чтения не важны. */
async function caseTitles(): Promise<Map<string, string>> {
  const dir = resolve(process.cwd(), 'testset/cases');
  const titles = new Map<string, string>();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  } catch {
    return titles;
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as {
        id?: unknown;
        text?: unknown;
      };
      if (typeof raw.id === 'string' && typeof raw.text === 'string') {
        titles.set(raw.id, raw.text);
      }
    } catch {
      // битый файл набора не должен ломать экран
    }
  }
  return titles;
}

/** Последний отчёт: файла нет — пустая страница, файл битый — пустая с пометкой. */
export async function readQualityReport(path = reportPath()): Promise<QualityReport> {
  try {
    const report = parseQualityReport(await readFile(path, 'utf8'));
    return applyCaseTitles(report, await caseTitles());
  } catch (error) {
    return isMissing(error) ? emptyReport() : unreadableReport(error);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(httpError(`Прогон не уложился в ${Math.round(ms / 1000)} с`, 504));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

/**
 * Прогон набора без сети: `runEval` использует записанные ответы `testset/stubs`.
 * `running` снимается, только когда движок действительно закончил: если ответ
 * уже отдан по таймауту, второй прогон всё равно не стартует поверх первого.
 */
export async function startQualityRun(): Promise<QualityReport> {
  if (running) throw httpError('Прогон уже идёт: дождитесь результата', 409);
  running = true;
  const job = (async () => {
    const { runEval } = await import('./run');
    return runEval({ limit: QUALITY_CASE_LIMIT });
  })();
  void job
    .catch(() => undefined)
    .finally(() => {
      running = false;
    });
  const run = await withTimeout(job, QUALITY_RUN_TIMEOUT_MS);
  return reportFromRun(run);
}

export default defineModule({
  id: 'quality',
  title: 'Оценка качества разбора',
  enabledByDefault: true,
  routes(router) {
    router.get('/report', 'reports', async () => readQualityReport(), {
      response: QualityReport,
    });
    router.post('/run', 'reports', async () => startQualityRun(), {
      body: QualityRunRequest,
      response: QualityReport,
    });
  },
});
