import { shortTicketNumber } from '@ugra/contracts';
import './knowledge.css';
import type { Ticket, TicketListResponse, TicketResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Icon, Modal, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { ArticleView } from './ArticleView';
import { DraftPanel } from './DraftPanel';
import { SearchHero } from './SearchHero';
import {
  activeTasks,
  articleRows,
  buildDraft,
  categoryLabels,
  pluralRu,
  relatedGroups,
} from './format';
import type { ArticleDraft, KnowledgeArticle, KnowledgeResponse } from './format';
import type { Loadable } from './types';

/**
 * База знаний инженера: крупный поиск, статья целиком, черновик из решений.
 * Вопрос агенту остался на сервере (`POST /api/m/knowledge/ask`) — экран живёт поиском.
 */

const EMPTY_LOAD: Loadable<never> = { loading: false, error: null, data: null };
/** Короче двух символов сервер искать не просим: шум в выдаче. */
const SEARCH_MIN = 2;
/** Поиск после паузы в вода, чтобы не дёргать сервер на каждую букву. */
const SEARCH_DEBOUNCE_MS = 350;
/** Сколько заявок читаем, собирая черновик статьи. */
const DRAFT_TICKETS = 5;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function KnowledgePage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const labels = useMemo(() => categoryLabels(meta), [meta]);

  const [text, setText] = useState(() => query.get('q') ?? '');
  const [search, setSearch] = useState<Loadable<KnowledgeResponse>>(EMPTY_LOAD);
  const [searchTick, setSearchTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [pickOpen, setPickOpen] = useState(false);
  const [pickState, setPickState] = useState<Loadable<Ticket[]>>(EMPTY_LOAD);
  const moreRef = useRef<HTMLUListElement | null>(null);

  const rows = useMemo(() => articleRows(search.data?.articles, text, labels), [search.data, text, labels]);
  const related = useMemo(() => relatedGroups(search.data?.tickets ?? []), [search.data]);
  const collected = related.reduce((sum, group) => sum + group.count, 0);
  const hasQuery = text.trim().length >= SEARCH_MIN;
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const others = rows.filter((row) => row.id !== selectedRow?.id);
  useListMotion(moreRef, others.length > 0);

  useEffect(() => {
    const value = text.trim();
    if (value.length < SEARCH_MIN) {
      setSearch(EMPTY_LOAD);
      setDraft(null);
      return undefined;
    }
    let alive = true;
    setSearch((previous) => ({ loading: true, error: null, data: previous.data }));
    const timer = window.setTimeout(() => {
      api
        .get<KnowledgeResponse>(`/api/m/knowledge/search?q=${encodeURIComponent(value)}`)
        .then((response) => {
          if (!alive) return;
          setSearch({ loading: false, error: null, data: response });
          setDraft(null);
          setDraftError(null);
          // Первую статью выбираем сразу: экран открывается с решением, а не со списком.
          setSelectedId(null);
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
  }, [api, text, searchTick]);

  const toggleStep = useCallback(
    (article: KnowledgeArticle, index: number): void => {
      trackAction?.('select');
      const key = `${article.id}:${index}`;
      setChecked((previous) => ({ ...previous, [key]: !previous[key] }));
    },
    [trackAction],
  );

  const buildDraftView = useCallback(async (): Promise<void> => {
    const data = search.data;
    if (!data) return;
    trackAction?.('click');
    setDraftBusy(true);
    setDraftError(null);
    try {
      const sources = data.tickets.filter((ticket) => ticket.status !== 'cancelled').slice(0, DRAFT_TICKETS);
      const details = await Promise.all(
        sources.map((ticket) =>
          api.get<TicketResponse>(`/api/tickets/${ticket.ticketId}`).catch(() => null),
        ),
      );
      const resolutions = details.map((detail, index) => ({
        number: sources[index]?.number ?? '',
        text: detail?.ticket.resolution ?? '',
      }));
      setDraft(
        buildDraft({
          query: text,
          articles: data.articles,
          tickets: data.tickets,
          resolutions,
        }),
      );
    } catch (cause: unknown) {
      setDraftError(errorText(cause));
    } finally {
      setDraftBusy(false);
    }
  }, [api, search.data, text, trackAction]);

  const openTaskPicker = useCallback((): void => {
    trackAction?.('click');
    setPickOpen(true);
    setPickState({ loading: true, error: null, data: null });
    api
      .get<TicketListResponse>(`/api/tickets?assigneeId=${encodeURIComponent(user.id)}&limit=200`)
      .then((response) => {
        setPickState({ loading: false, error: null, data: activeTasks(response.tickets, user.id) });
      })
      .catch((cause: unknown) => {
        setPickState({ loading: false, error: errorText(cause), data: null });
      });
  }, [api, trackAction, user.id]);

  function takeToTask(ticketId: string): void {
    if (!selectedRow) return;
    trackAction?.('navigate');
    setPickOpen(false);
    navigate(`/tasks?ticket=${encodeURIComponent(ticketId)}&article=${encodeURIComponent(selectedRow.id)}`);
  }

  const pickTasks = pickState.data ?? [];

  return (
    <div className="kb-page">
      <SearchHero
        query={text}
        busy={search.loading && rows.length === 0}
        onChange={(value) => {
          setText(value);
          trackAction?.('input');
        }}
        onSubmit={() => setSearchTick((value) => value + 1)}
      />

      {!hasQuery && (
        <Card className="kb-empty-card">
          <EmptyState
            title="Опишите, что сломалось"
            hint="Своими словами: симптом, модель устройства или код ошибки. Найдём статью и покажем шаги."
            icon={<Icon name="kb" size={22} />}
          />
        </Card>
      )}

      <div className={hasQuery ? 'kb-layout' : 'kb-layout kb-layout--idle'}>
        <div className="kb-col">
          {search.error && (
            <Card tone="danger">
              <h2 className="kb-card-title">База знаний не отвечает</h2>
              <p className="kb-answer__text">{search.error}</p>
              <Button variant="secondary" size="sm" onClick={() => setSearchTick((value) => value + 1)}>
                Повторить
              </Button>
            </Card>
          )}

          {search.loading && rows.length === 0 && !search.error && (
            <Card className="kb-loading-card">
              <Skeleton lines={4} />
            </Card>
          )}

          {hasQuery && !search.loading && !search.error && rows.length === 0 && (
            <Card>
              <EmptyState
                title="Статьи по этому запросу нет"
                hint="Назовите модель или код ошибки — или соберите черновик из решений похожих заявок."
                icon={<Icon name="kb" size={22} />}
              />
            </Card>
          )}

          {selectedRow && (
            <ArticleView
              row={selectedRow}
              best={selectedRow.id === rows[0]?.id}
              checked={checked}
              related={related}
              collected={collected}
              taking={pickState.loading}
              onToggleStep={(index) => toggleStep(selectedRow.article, index)}
              onTakeToTask={openTaskPicker}
            />
          )}
        </div>

        <aside className="kb-side">
          <DraftPanel
            query={text}
            articleCount={rows.length}
            ticketsCount={related.length > 0 ? collected : search.data?.tickets.length ?? 0}
            related={related}
            draft={draft}
            building={draftBusy}
            error={draftError}
            onBuild={() => void buildDraftView()}
          />

          {others.length > 0 && (
            <Card className="kb-more">
              <p className="kb-list__head">
                Ещё {others.length} {pluralRu(others.length, 'совпадение', 'совпадения', 'совпадений')}
              </p>
              <ul className="kb-more__items" ref={moreRef}>
                {others.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="kb-more__row"
                      onClick={() => {
                        trackAction?.('select');
                        setSelectedId(row.id);
                      }}
                    >
                      <span className="kb-more__title">{row.title}</span>
                      {row.summary !== '' && <span className="kb-more__summary">{row.summary}</span>}
                      {row.helpLabel !== null && <span className="kb-more__help">{row.helpLabel}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <Modal open={pickOpen} title="Взять статью в задачу" onClose={() => setPickOpen(false)}>
        {pickState.loading && <Skeleton lines={3} />}

        {!pickState.loading && pickState.error && (
          <div className="kb-pick" role="alert">
            <p>Задачи не загрузились: {pickState.error}</p>
            <Button variant="secondary" size="sm" onClick={openTaskPicker}>
              Повторить
            </Button>
          </div>
        )}

        {!pickState.loading && !pickState.error && pickTasks.length === 0 && (
          <EmptyState
            title="Активных задач нет"
            hint="Возьмите заявку в «Моих задачах» — и вернитесь сюда за инструкцией."
          >
            <Button variant="secondary" onClick={() => navigate('/tasks')}>
              Открыть мои задачи
            </Button>
          </EmptyState>
        )}

        {pickTasks.length > 0 && (
          <div className="kb-pick">
            <p className="kb-pick__lead">Статья откроется на карточке выбранной задачи.</p>
            <ul className="kb-pick__list">
              {pickTasks.map((ticket) => (
                <li key={ticket.id}>
                  <button type="button" className="kb-pick__row" onClick={() => takeToTask(ticket.id)}>
                    <span className="kb-pick__number">№ {shortTicketNumber(ticket.number)}</span>
                    <span className="kb-pick__title">
                      {ticket.status === 'in_progress' ? 'В работе' : 'Назначена'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
