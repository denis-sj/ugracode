import './knowledge.css';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InsightBlock,
  SearchField,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  articleRows,
  articleStats,
  askModeLabel,
  categoryLabels,
  categoryName,
  normalizeArticle,
  pluralRu,
  sourceLinks,
  stepKey,
  stepsDone,
} from './format';
import type { AskResponse, KnowledgeArticle, KnowledgeResponse } from './format';

/**
 * Экран 13 «База знаний» (инженер, 4.6): поиск своими словами, статья с шагами,
 * вопрос базе с ответом агента и ссылками-источниками.
 */

interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

const EMPTY_LOAD: Loadable<never> = { loading: false, error: null, data: null };
/** Короче двух символов сервер искать не просим: шум в выдаче. */
const SEARCH_MIN = 2;
/** Поиск после паузы в вода, чтобы не дёргать сервер на каждую букву. */
const SEARCH_DEBOUNCE_MS = 350;
/** Минимальная длина вопроса — как в схеме `POST /api/m/knowledge/ask`. */
const QUESTION_MIN = 3;
/** Маршрута черновика статьи в API нет — кнопка честно выключена. */
const DRAFT_HINT =
  '❓ Маршрута «Собрать черновик статьи» в API пока нет: нужен способ собрать статью из решений закрытых заявок.';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** HTTP-код ошибки API: по 422 отличаем «статей нет» от падения сети. */
function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function askErrorText(error: unknown): string {
  if (errorStatus(error) === 422) {
    return 'База знаний не нашла статей по этому вопросу. Назовите модель устройства или код ошибки — либо найдите статью поиском.';
  }
  return `Не удалось получить ответ: ${errorText(error)}`;
}

/** Шаги ответа без мусора: сервер может вернуть не строки. */
function answerSteps(steps: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter((step): step is string => typeof step === 'string' && step.trim() !== '');
}

/** Кнопка «Собрать черновик статьи»: маршрута нет — выключена и объясняет почему. */
function DraftButton(): JSX.Element {
  return (
    <Button variant="primary" block disabled title={DRAFT_HINT}>
      Собрать черновик статьи
    </Button>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div className="kb-skeleton" aria-label="Загружаем базу знаний">
      {Array.from({ length: lines }, (_value, index) => (
        <span
          key={index}
          className={index === lines - 1 ? 'kb-skeleton__line kb-skeleton__line--short' : 'kb-skeleton__line'}
        />
      ))}
    </div>
  );
}

export function KnowledgePage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const labels = useMemo(() => categoryLabels(meta), [meta]);

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Loadable<KnowledgeResponse>>(EMPTY_LOAD);
  const [searchTick, setSearchTick] = useState(0);
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const [askQuestion, setAskQuestion] = useState('');
  const [ask, setAsk] = useState<Loadable<AskResponse>>(EMPTY_LOAD);
  const [askBusy, setAskBusy] = useState(false);

  const listRef = useRef<HTMLUListElement | null>(null);

  const rows = useMemo(() => articleRows(search.data?.articles, query, labels), [search.data, query, labels]);
  useListMotion(listRef, rows.length > 0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < SEARCH_MIN) {
      setSearch(EMPTY_LOAD);
      setSelected(null);
      setOpenError(null);
      return undefined;
    }
    let alive = true;
    setSearch((previous) => ({ loading: true, error: null, data: previous.data }));
    const timer = window.setTimeout(() => {
      api
        .get<KnowledgeResponse>(`/api/m/knowledge/search?q=${encodeURIComponent(text)}`)
        .then((response) => {
          if (!alive) return;
          setSearch({ loading: false, error: null, data: response });
          setSelected(articleRows(response?.articles, text, labels)[0]?.article ?? null);
          setOpenError(null);
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          setSearch({ loading: false, error: errorText(cause), data: null });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [api, labels, query, searchTick]);

  const checkedIndexes = useMemo(() => {
    const set = new Set<number>();
    if (!selected) return set;
    selected.steps.forEach((_step, index) => {
      if (checked[stepKey(selected.id, index)]) set.add(index);
    });
    return set;
  }, [checked, selected]);
  const progress = stepsDone(selected?.steps, checkedIndexes);
  const stats = articleStats(selected);

  const links = sourceLinks(ask.data?.sources);
  const answer = typeof ask.data?.answer === 'string' ? ask.data.answer.trim() : '';
  const askSteps = answerSteps(ask.data?.steps);
  const questionReady = askQuestion.trim().length >= QUESTION_MIN;

  const openArticle = useCallback(
    (id: string, title: string): void => {
      trackAction?.('navigate');
      setOpenError(null);
      api
        .get<{ article: unknown }>(`/api/m/knowledge/articles/${encodeURIComponent(id)}`)
        .then((response) => {
          const article = normalizeArticle(response?.article);
          if (!article) {
            setOpenError(`Статья «${title}» не найдена в базе знаний`);
            return;
          }
          setSelected(article);
        })
        .catch((cause: unknown) => setOpenError(errorText(cause)));
    },
    [api, trackAction],
  );

  function toggleStep(articleId: string, stepIndex: number): void {
    trackAction?.('select');
    const key = stepKey(articleId, stepIndex);
    setChecked((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function askBase(): void {
    const question = askQuestion.trim();
    if (question.length < QUESTION_MIN) {
      setAsk({ loading: false, error: 'Опишите вопрос хотя бы тремя символами', data: null });
      return;
    }
    trackAction?.('click');
    setAskBusy(true);
    setAsk({ loading: true, error: null, data: null });
    setOpenError(null);
    api
      .post<AskResponse>('/api/m/knowledge/ask', { question })
      .then((response) => setAsk({ loading: false, error: null, data: response }))
      .catch((cause: unknown) => setAsk({ loading: false, error: askErrorText(cause), data: null }))
      .finally(() => setAskBusy(false));
  }

  const hasQuery = query.trim().length >= SEARCH_MIN;

  return (
    <div className="kb-page">
      <header className="kb-head" data-reveal>
        <div className="kb-head__titles">
          <h1 className="ugra-page-title">База знаний</h1>
          <p className="kb-head__lead">
            Инструкции и решения из закрытых заявок. ИИ ищет здесь, когда подсказывает инженеру.
          </p>
        </div>
        <SearchField
          className="kb-head__search"
          label="Поиск по базе знаний"
          placeholder="Своими словами: «принтер жуёт бумагу»"
          value={query}
          onChange={(value) => {
            setQuery(value);
            trackAction?.('input');
          }}
        />
      </header>

      <div className="kb-layout">
        <div className="kb-col">
          <Card padded={false} className="kb-list">
            <p className="kb-list__head">
              {rows.length > 0
                ? `Найдено ${rows.length} ${pluralRu(rows.length, 'статья', 'статьи', 'статей')}`
                : 'Статьи базы знаний'}
            </p>

            {search.loading && rows.length === 0 && (
              <div className="kb-list__pad">
                <Skeleton lines={3} />
              </div>
            )}

            {!hasQuery && !search.loading && (
              <p className="kb-list__empty-hint">
                Опишите проблему своими словами — покажем подходящие статьи.
              </p>
            )}

            {rows.length > 0 && (
              <ul className="kb-list__items" aria-label="Найденные статьи" ref={listRef}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={selected?.id === row.id ? 'kb-row kb-row--on' : 'kb-row'}
                      aria-current={selected?.id === row.id ? 'true' : undefined}
                      onClick={() => {
                        trackAction?.('select');
                        setSelected(row.article);
                        setOpenError(null);
                      }}
                    >
                      <span className="kb-row__title">{row.title}</span>
                      {row.symptoms !== '' && <span className="kb-row__symptoms">{row.symptoms}</span>}
                      <span className="kb-row__foot">
                        <span className="kb-row__meta">{row.categoryLabel}</span>
                        {row.scoreLabel && (
                          <span className="kb-score" title="Оценка релевантности от сервера — не проценты">
                            совпадение {row.scoreLabel}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="kb-draft">
            <h2 className="kb-card-title">Нет статьи, а заявки идут</h2>
            <p className="kb-draft__text">
              Черновик собирается из решений закрытых заявок. Пока маршрута в API нет — кнопка выключена.
            </p>
            <DraftButton />
            <p className="kb-hint">❓ Нужен маршрут сборки черновика из решений по одной проблеме.</p>
          </Card>
        </div>

        <div className="kb-col">
          <Card className="kb-ask">
            <h2 className="kb-card-title">Спросить базу</h2>
            <label className="kb-field">
              <span className="kb-label">Вопрос инженера</span>
              <textarea
                className="kb-textarea"
                rows={3}
                value={askQuestion}
                placeholder="Например: принтер HP мигает красным, что проверить сначала?"
                onChange={(event) => {
                  setAskQuestion(event.target.value);
                  trackAction?.('input');
                }}
              />
            </label>
            <div className="kb-ask__actions">
              <Button variant="primary" loading={askBusy} disabled={!questionReady} onClick={askBase}>
                Спросить
              </Button>
              <span className="kb-hint">
                Агент ищет статьи инструментами и ссылается только на найденное — без выдуманных источников.
              </span>
            </div>
          </Card>

          {ask.loading && (
            <Card className="kb-loading-card" aria-label="Ищем ответ в базе знаний">
              <Skeleton lines={2} />
            </Card>
          )}

          {!ask.loading && ask.error && (
            <Card tone="danger">
              <h2 className="kb-card-title">Ответ не получен</h2>
              <p className="kb-answer__text">{ask.error}</p>
              <Button variant="secondary" size="sm" onClick={askBase}>
                Повторить
              </Button>
            </Card>
          )}

          {!ask.loading && ask.data && (
            <Card className="kb-answer">
              <div className="kb-answer__head">
                <h2 className="kb-card-title">Ответ базы знаний</h2>
                <Badge tone={ask.data.mode === 'template' ? 'warn' : 'accent'}>
                  {askModeLabel(ask.data.mode)}
                </Badge>
              </div>

              {answer !== '' ? (
                <p className="kb-answer__text">{answer}</p>
              ) : (
                <p className="kb-hint">Модель не вернула текст ответа — откройте источники ниже.</p>
              )}

              {askSteps.length > 0 && (
                <ol className="kb-answer__steps">
                  {askSteps.map((step, index) => (
                    <li key={`${index}-${step}`}>{step}</li>
                  ))}
                </ol>
              )}

              {links.length > 0 && (
                <div className="kb-answer__sources">
                  <span className="kb-label">Источники</span>
                  <div className="kb-answer__links">
                    {links.map((source) => (
                      <button
                        type="button"
                        key={source.id}
                        className="kb-source"
                        onClick={() => openArticle(source.id, source.title)}
                      >
                        <span className="kb-source__title">«{source.title}»</span>
                        <span className="kb-source__id">{source.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {ask.data.mode === 'template' && (
                <p className="kb-hint">Ответ по статьям без модели — проверьте шаги статьи перед выездом.</p>
              )}
            </Card>
          )}

          {openError && (
            <Card tone="danger">
              <h2 className="kb-card-title">Статья не открылась</h2>
              <p className="kb-answer__text">{openError}</p>
            </Card>
          )}

          {!hasQuery && (
            <Card>
              <EmptyState
                title="Начните искать"
                hint="Опишите симптом своими словами: «принтер жуёт бумагу», «нет сети в кабинете», «ошибка лицензии 1С»."
                icon="⌕"
              />
            </Card>
          )}

          {hasQuery && !search.loading && !search.error && rows.length === 0 && (
            <Card>
              <EmptyState
                title="Ничего не нашли"
                hint="Соберите черновик статьи из решений закрытых заявок — или измените запрос: модель, код ошибки, симптом."
                icon="⌕"
              >
                <DraftButton />
              </EmptyState>
            </Card>
          )}

          {search.error && (
            <Card tone="danger">
              <h2 className="kb-card-title">База знаний не отвечает</h2>
              <p className="kb-answer__text">{search.error}</p>
              <Button variant="secondary" size="sm" onClick={() => setSearchTick((value) => value + 1)}>
                Повторить
              </Button>
            </Card>
          )}

          {selected && (
            <Card as="article" className="kb-article">
              <div className="kb-article__meta">
                <Badge tone="neutral">{categoryName(selected.category, labels)}</Badge>
                <span className="kb-article__id">статья {selected.id}</span>
              </div>
              <h2 className="kb-article__title">{selected.title}</h2>

              {selected.symptoms.length > 0 && (
                <section className="kb-article__block">
                  <h3 className="kb-label">Симптомы</h3>
                  <ul className="kb-symptoms">
                    {selected.symptoms.map((symptom) => (
                      <li key={symptom}>{symptom}</li>
                    ))}
                  </ul>
                </section>
              )}

              {selected.steps.length > 0 && (
                <section className="kb-article__block">
                  <div className="kb-steps__head">
                    <h3 className="kb-label">Шаги статьи</h3>
                    <span className="kb-steps__count">{progress.label}</span>
                  </div>
                  <ol className="kb-steps">
                    {selected.steps.map((step, index) => {
                      const on = checkedIndexes.has(index);
                      return (
                        <li key={stepKey(selected.id, index)}>
                          <button
                            type="button"
                            className={on ? 'kb-step kb-step--done' : 'kb-step'}
                            aria-pressed={on}
                            onClick={() => toggleStep(selected.id, index)}
                          >
                            <span className={on ? 'kb-step__box kb-step__box--on' : 'kb-step__box'} aria-hidden="true">
                              {on && (
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M5 12l5 5 9-10" />
                                </svg>
                              )}
                            </span>
                            <span className="kb-step__text">
                              <span className="kb-step__num">{index + 1}.</span> {step}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="kb-hint">Отметки живут в этом окне: на экране базы знаний заявки нет.</p>
                </section>
              )}

              {selected.solution !== '' && (
                <InsightBlock kind="meaning" title="Что обычно помогает">
                  {selected.solution}
                </InsightBlock>
              )}

              {stats && (
                <div className="kb-article__stats" data-reveal>
                  <span className="kb-label">Статистика статьи</span>
                  <strong className="kb-article__stat-value">{stats.label}</strong>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
