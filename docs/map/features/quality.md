# Карта фичи: оценщик качества (014)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-core.md](../../specs/case9-core.md#310-оценка-качества), [../../history/2026-11.md](../../history/2026-11.md), [../../history/2026-11.md](../../history/2026-11.md)

`pnpm eval` гоняет контрольный набор через тот же `PipelineEngine`, что и демо, и считает оценщики
раздела 5 харнесса. Результат — таблица «эталон / ИИ» в `reports/quality.md` (её владелец переносит
на слайд) и полные траектории в `reports/eval-<дата-время>.json`. Экрана «Качество» и таблицы `eval_run`
нет: по решению брейншторма это COULD.

## Файлы

| Файл | Что там |
|---|---|
| `modules/quality/server/metrics.ts` | чистые оценщики: сравнение полей по `evalMode`, выдуманные поля, авария, приоритет, исполнитель, статья, вопрос, траектория, медианы, сводка с порогами |
| `modules/quality/server/run.ts` | прогон набора: загрузка `data/*.json` и `testset/cases`, заглушка `StubLlm` из `testset/stubs/NN.json`, `MemoryStore` + `KernelEventBus`, сбор наблюдений и метрик шагов, `evalReportJson()` |
| `modules/quality/server/report.ts` | отчёт: таблица «эталон / ИИ», таблица по обращениям, провалы по оценщикам, оговорки; консольная версия |
| `modules/quality/server/index.ts` | `defineModule`: у модуля нет шагов, инструментов и агентов — он не участвует в разборе |
| `modules/quality/tests/` | режимы сравнения, выдуманные поля, пропуски, все оценщики, агрегаты и пороги, мини-прогон на фикстурах, тест-контракт |
| `scripts/eval.ts` | CLI `pnpm eval [--model <id>] [--cloud] [--case NN]`: консоль, `reports/quality.md`, `reports/eval-<дата>.json` |

## Как работает

1. `runEval()` грузит `data/*.json` (реестр полей, справочники, CMDB, матрица приоритета, инженеры)
   и собирает шаги `coreSteps()` + `modules/registry.server.ts`; регистры собираются один раз на прогон.
2. На каждый кейс — свой `MemoryStore`, `KernelEventBus` и `PipelineEngine`. Обращение: `id: eval-<кейс>`,
   текст из файла, канал из `channel`, автор — «Заявитель (прогон)» с ролью `applicant`.
3. Заглушка модели: `StubLlm` со сценарием из `testset/stubs/NN.json` (номер — из имени файла кейса).
   Запись приводится к `submit` агента `intake`: `fields`, `emergency` из `aspects.emergency`,
   `summary` из `aspects.summary.text`, `clarify: null`. Если в записи есть поля без цитаты, `check()`
   её отклоняет — второй ход сценария повторяет `submit` без них (как исправление модели по ошибке).
4. `--model <id>` или `--cloud` → `createPorts({ …process.env, AI_MODE: 'cloud', LLM_MODEL_MAIN: id })`.
   Ключа нет — прогон честно уходит в заглушку и пишет предупреждение в отчёт.
5. Из черновика собирается `ObservedRun`: поля с цитатами и `origin`, приоритет, авария (вердикт
   `draft.emergency` или мнение агента `draft.ext.extraction.emergency.suspected`), топ исполнителей,
   статьи (`draft.knowledge` + `kb_get_article` из шагов), вопрос (`clarify` или вопрос агента),
   вызванные инструменты и их число.
6. Оценщики `metrics.ts` дают попадания, промахи и выдуманные поля; `summarize()` собирает доли,
   медианы и список невыполненных порогов.
7. `scripts/eval.ts` печатает таблицу, пишет `reports/quality.md` и `reports/eval-<дата>.json`,
   код выхода 0 даже при невыполненных порогах (провал порога — результат прогона, а не ошибка запуска).

Пороги (раздел 5.2 харнесса, в `THRESHOLDS`): поля ≥ 90 %, выдуманные поля 0, пропуски аварии 0,
приоритет ≥ 90 %, исполнитель топ-1 ≥ 70 % и топ-3 ≥ 90 %, статья ≥ 80 %, вопрос ≥ 80 %,
траектория 100 %, медиана ≤ 8 с и ≤ 0,30 ₽.

## Точки входа

| Что | Где |
|---|---|
| `pnpm eval` | `package.json` (`tsx scripts/eval.ts`) |
| Один кейс с трассировкой | `pnpm eval --case 04` → `runEval({ caseId })`, печать `run.cases[0].trace` |
| Оценщики как функции | `metrics.ts`: `evaluateFields`, `evaluatePriority`, `evaluateEmergency`, `evaluateAssignee`, `evaluateArticle`, `evaluateQuestion`, `evaluateTrajectory`, `summarize` |
| Прогон без CLI (тесты, отчёты) | `runEval({ dirs, model, cloud, caseId })` |
| Отчёт | `renderQualityReport(run)` / `renderConsole(run)`, `evalReportJson(run)` |
| Регистрация модуля | `modules/registry.server.ts` — одна строка `quality` |

## Проверки

```bash
npx vitest run modules/quality
npx tsx scripts/eval.ts            # создаёт reports/quality.md и reports/eval-<дата>.json
```

- сравнение полей: `exact` без нормализации, `normalized` без регистра и «ё», `none` — поле не оценивается;
- выдуманные поля: нет в эталоне, цитаты нет в тексте, нет цитаты; значения из CMDB (`origin: 'cmdb'`) — не выдумка;
- пропуск: пустое поле эталона, промах приоритета, пропуск аварии, промах исполнителя и статьи;
- агрегаты: все пороги выполнены / не выполнены, «—» без эталона и это не провал;
- мини-прогон на двух кейсах во временной папке: успешный кейс, мусорный эталон, битый файл в `skipped`;
- тест-контракт модуля и сквозной прогон с выключенным модулем.

## Особенности

- `example.extract` (модуль-образец) пишет `building`, `cabinet`, `equipment` правилами. Если в эталоне
  этих ключей нет, поле считается выдуманным — набор должен описывать все поля, которые видит диспетчер.
- Статью в прогоне пока выбрать нечем: у модуля `knowledge` только инструменты, шага выбора статьи нет,
  а агент `intake` инструменты базы знаний не имеет. Оценщик статьи честно показывает 0 %, пока не
  появится шаг выбора (`knowledge.select`).
- `data/engineers.json` не проходит схему `modules/routing/contracts.ts` (`level: "first_line"` — строка,
  схема ждёт число), поэтому подбор идёт по `DEMO_ENGINEERS` (`u-eng-*`) и топ-3 не совпадает с эталоном
  (`u-engineer-*`). Это данные и модуль `routing`, не оценщик.
- Авария оценивается по вердикту `draft.emergency` или по мнению агента: модуль `emergency` в реестр
  ещё не включён, поэтому приоритет «Авария» код пока не выставляет.
- Настроечного набора `testset/dev/` нет — об этом сказано в самом отчёте, чтобы цифры не выдавали
  за настройку по большому набору.
