import type { ApiClient } from '@ugra/ui';
import type { QualityReport } from '../contracts';

/** Клиент экрана «Качество ИИ»: только маршруты модуля и cookie-сессия. */

export const QUALITY_REPORT_PATH = '/api/m/quality/report';
export const QUALITY_RUN_PATH = '/api/m/quality/run';

/** Последний отчёт из `reports/quality.md`; файла нет — пустая страница. */
export function loadQualityReport(api: ApiClient): Promise<QualityReport> {
  return api.get<QualityReport>(QUALITY_REPORT_PATH);
}

/** Прогон набора в режиме заглушки: без сети и без ключей модели. */
export function runQualityEval(api: ApiClient): Promise<QualityReport> {
  return api.post<QualityReport>(QUALITY_RUN_PATH, {});
}
