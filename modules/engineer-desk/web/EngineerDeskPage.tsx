import './engineer-desk.css';
import type { Ticket, TicketListResponse, TicketResponse, TicketStatus, User, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InsightBlock,
  Modal,
  PriorityBars,
  SearchField,
  formatDue,
  formatDateTime,
  formatTicketStatus,
  ticketStatusTone,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  ACTION_LABELS,
  appendOutcome,
  asTicketStatus,
  deadlineInputToIso,
  defaultDeadlineInput,
  dueState,
  equipmentLine,
  knowledgeQuery,
  myTasks,
  pickArticle,
  pluralRu,
  quickOutcomes,
  reasonReady,
  recurringEquipmentCount,
  sortMyTasks,
  statusActions,
  stepProgress,
  taskEquipment,
  taskPlace,
  taskTitle,
  tasksCountLabel,
} from './format';
import type { KnowledgeArticle, KnowledgeResponse } from './format';

type Tab = 'tasks' | 'kb';
type MessageTone = 'ok' | 'error';

interface Message {
  text: string;
  tone: MessageTone;
}

interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

interface TaskPreview {
  title: string;
  place: string;
  equipment: string;
}

const EMPTY_LOAD: Loadable<never> = { loading: false, error: null, data: null };
/** Сколько задач подгружаем с полями для списка: остальные покажем по категории. */
const PREVIEW_LIMIT = 12;
/** Поиск в базе знаний — после паузы в вода, чтобы не дёргать сервер на каждую букву. */
const KB_DEBOUNCE_MS = 350;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function previewFrom(
  meta: WebPageProps['meta'],
  ticket: Ticket,
  detail: TicketResponse | null,
): TaskPreview {
  const fields = detail?.fields ?? [];
  return {
    title: taskTitle(meta, ticket, fields),
    place: taskPlace(meta, fields),
    equipment: equipmentLine(fields),
  };
}

function StatusBadge({ status }: { status: TicketStatus }): JSX.Element {
  return (
    <Badge tone={ticketStatusTone(status)} dot={status === 'in_progress'}>
      {formatTicketStatus(status)}
    </Badge>
  );
}

interface StepChecklistProps {
  article: KnowledgeArticle;
  checked: Readonly<Record<string, boolean>>;
  onToggle: (key: string) => void;
  /** Подпись над шагами: на задаче «Диагностика», в статье — «Шаги статьи». */
  caption?: string;
}

/** Шаги статьи чек-листом: отметки живут только в интерфейсе и не уходят в API. */
function StepChecklist({ article, checked, onToggle, caption = 'Диагностика' }: StepChecklistProps): JSX.Element {
  const set = new Set(
    article.steps.map((_step, index) => index).filter((index) => checked[`${article.id}:${index}`]),
  );
  const progress = stepProgress(article.steps, set);
  return (
    <div className="ed-steps">
      <p className="ed-steps__caption">
        {caption} · {progress.done} из {progress.total}
      </p>
      <ul className="ed-steps__list">
        {article.steps.map((step, index) => {
          const key = `${article.id}:${index}`;
          const on = Boolean(checked[key]);
          return (
            <li key={key}>
              <button
                type="button"
                className={on ? 'ed-step ed-step--done' : 'ed-step'}
                aria-pressed={on}
                onClick={() => onToggle(key)}
              >
                <span className={on ? 'ed-step__box ed-step__box--on' : 'ed-step__box'} aria-hidden="true">
                  {on && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
                <span className="ed-step__text">{step}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="ed-steps__source">Из статьи «{article.title}»</p>
    </div>
  );
}

interface ArticleCardProps {
  article: KnowledgeArticle;
  checked: Readonly<Record<string, boolean>>;
  onToggle: (key: string) => void;
}

/** Статья целиком: симптомы, что обычно помогает, шаги. */
function ArticleCard({ article, checked, onToggle }: ArticleCardProps): JSX.Element {
  return (
    <Card className="ed-article">
      <h3 className="ed-article__title">{article.title}</h3>
      {article.symptoms.length > 0 && (
        <div className="ed-article__block">
          <span className="ed-label">Симптомы</span>
          <ul className="ed-symptoms">
            {article.symptoms.map((symptom) => (
              <li key={symptom}>{symptom}</li>
            ))}
          </ul>
        </div>
      )}
      <StepChecklist article={article} checked={checked} onToggle={onToggle} caption="Шаги статьи" />
      {article.solution && (
        <InsightBlock kind="meaning" title="Что обычно помогает">
          {article.solution}
        </InsightBlock>
      )}
    </Card>
  );
}

/** Рабочее место инженера (4.6): задачи на сегодня, диагностика из базы знаний, результат. */
export function EngineerDeskPage({ user, meta, api, trackAction }: WebPageProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('tasks');

  const [tasks, setTasks] = useState<Ticket[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, TaskPreview>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTick, setDetailTick] = useState(0);

  const [diagnostics, setDiagnostics] = useState<Loadable<KnowledgeResponse>>(EMPTY_LOAD);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  const [resultText, setResultText] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [retry, setRetry] = useState<{ run: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState('');
  const [deadlineReason, setDeadlineReason] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');

  const [kbQuery, setKbQuery] = useState('');
  const [kbState, setKbState] = useState<Loadable<KnowledgeResponse>>(EMPTY_LOAD);
  const [kbArticleId, setKbArticleId] = useState<string | null>(null);
  const [kbTick, setKbTick] = useState(0);

  const now = useNow(30_000);

  const tasksRef = useRef<HTMLUListElement | null>(null);
  const kbRef = useRef<HTMLUListElement | null>(null);
  useListMotion(tasksRef, tab === 'tasks' && tasks.length > 0);
  useListMotion(kbRef, tab === 'kb' && (kbState.data?.articles.length ?? 0) > 0);

  const loadTasks = useCallback(
    async (mode: 'loud' | 'quiet' = 'loud'): Promise<void> => {
      if (mode === 'loud') {
        setTasksLoading(true);
        setTasksError(null);
      }
      try {
        const response = await api.get<TicketListResponse>(
          `/api/tickets?assigneeId=${encodeURIComponent(user.id)}&limit=200`,
        );
        const mine = sortMyTasks(myTasks(response.tickets, user.id));
        setTasks(mine);
        // Выбранную задачу не сбрасываем: после «Выполнено» инженер видит подтверждение
        // на той же карточке, хотя из списка активных она уже ушла.
        setSelectedId((previous) => previous ?? (mine[0]?.id ?? null));
        setTasksError(null);

        // Название и место в списке — из полей заявки: в списке API их нет.
        const entries = await Promise.all(
          mine.slice(0, PREVIEW_LIMIT).map(async (ticket) => {
            const loaded = await api.get<TicketResponse>(`/api/tickets/${ticket.id}`).catch(() => null);
            return [ticket.id, previewFrom(meta, ticket, loaded)] as const;
          }),
        );
        setPreviews(Object.fromEntries(entries));
      } catch (cause) {
        if (mode === 'loud') setTasksError(errorText(cause));
      } finally {
        if (mode === 'loud') setTasksLoading(false);
      }
    },
    [api, meta, user.id],
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    let alive = true;
    api
      .get<UsersResponse>('/api/users')
      .then((response) => {
        if (alive) setUsers(response.users);
      })
      .catch(() => {
        // Имена заявителя и исполнителя — подпись; без них карточка работает.
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    setResultText('');
    setCheckedSteps({});
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    let alive = true;
    setDetailLoading(true);
    setDetailError(null);
    api
      .get<TicketResponse>(`/api/tickets/${selectedId}`)
      .then((response) => {
        if (!alive) return;
        setDetail(response);
        setResultText((current) => {
          const saved = response.ticket.resolution?.trim() ?? '';
          return saved === '' ? current : saved;
        });
      })
      .catch((cause: unknown) => {
        if (alive) setDetailError(errorText(cause));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, selectedId, detailTick]);

  useEffect(() => {
    if (!detail) {
      setDiagnostics(EMPTY_LOAD);
      return undefined;
    }
    const query = knowledgeQuery(detail.fields, detail.ticket.category);
    if (query === '') {
      setDiagnostics(EMPTY_LOAD);
      return undefined;
    }
    let alive = true;
    setDiagnostics({ loading: true, error: null, data: null });
    api
      .get<KnowledgeResponse>(`/api/m/knowledge/search?q=${encodeURIComponent(query)}`)
      .then((response) => {
        if (alive) setDiagnostics({ loading: false, error: null, data: response });
      })
      .catch((cause: unknown) => {
        if (alive) setDiagnostics({ loading: false, error: errorText(cause), data: null });
      });
    return () => {
      alive = false;
    };
  }, [api, detail]);

  useEffect(() => {
    if (tab !== 'kb') return undefined;
    const query = kbQuery.trim();
    if (query.length < 2) {
      setKbState(EMPTY_LOAD);
      setKbArticleId(null);
      return undefined;
    }
    let alive = true;
    setKbState((previous) => ({ ...previous, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      api
        .get<KnowledgeResponse>(`/api/m/knowledge/search?q=${encodeURIComponent(query)}`)
        .then((response) => {
          if (!alive) return;
          setKbState({ loading: false, error: null, data: response });
          setKbArticleId(pickArticle(response.articles, query)?.id ?? null);
        })
        .catch((cause: unknown) => {
          if (alive) setKbState({ loading: false, error: errorText(cause), data: null });
        });
    }, KB_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [api, kbQuery, tab, kbTick]);

  const applicantName = useMemo(() => {
    const id = detail?.appeal.authorId;
    if (!id) return null;
    return users.find((candidate) => candidate.id === id)?.fullName ?? null;
  }, [detail, users]);

  const assigneeName = useMemo(() => {
    const id = detail?.ticket.assigneeId;
    if (!id) return null;
    return users.find((candidate) => candidate.id === id)?.fullName ?? null;
  }, [detail, users]);

  const diagnosticQuery = useMemo(
    () => (detail ? knowledgeQuery(detail.fields, detail.ticket.category) : ''),
    [detail],
  );

  const diagnosticArticle = useMemo(
    () =>
      diagnostics.data ? pickArticle(diagnostics.data.articles, diagnosticQuery) : null,
    [diagnosticQuery, diagnostics.data],
  );

  const similar = useMemo(
    () => (diagnostics.data?.tickets ?? []).filter((ticket) => ticket.ticketId !== detail?.ticket.id),
    [detail?.ticket.id, diagnostics.data],
  );

  const equipment = detail ? taskEquipment(detail.fields) : null;
  const equipmentLabel = equipment ? [equipment.equipment, equipment.model].filter(Boolean).join(' ') : '';
  const recurring = useMemo(() => {
    const key = equipment?.equipment ?? '';
    if (!key || similar.length === 0) return 0;
    return recurringEquipmentCount(similar, `${key} ${equipment?.model ?? ''}`);
  }, [equipment, similar]);

  const actions = detail ? statusActions(detail.ticket.status) : [];
  const canResolve = actions.includes('resolve');

  const title = detail ? taskTitle(meta, detail.ticket, detail.fields) : '';
  const place = detail ? taskPlace(meta, detail.fields) : '';
  const sla = detail ? dueState(detail.ticket.slaDueAt, now) : null;
  const react = detail ? dueState(detail.ticket.reactDueAt, now) : null;
  const quick = detail ? quickOutcomes(detail.ticket.category) : [];

  const kbArticles = kbState.data?.articles ?? [];
  const kbArticle =
    kbArticles.find((article) => article.id === kbArticleId) ??
    (kbState.data ? pickArticle(kbArticles, kbQuery) : null);

  const runAction = useCallback(
    async (key: string, run: () => Promise<void>, success: string): Promise<void> => {
      setBusy(key);
      setMessage(null);
      setRetry(null);
      try {
        await run();
        setMessage({ text: success, tone: 'ok' });
        trackAction?.('system');
        await loadTasks('quiet');
        setDetailTick((value) => value + 1);
      } catch (cause) {
        setMessage({ text: errorText(cause), tone: 'error' });
        setRetry({ run: () => void runAction(key, run, success) });
      } finally {
        setBusy(null);
      }
    },
    [loadTasks, trackAction],
  );

  function takeToWork(ticketId: string): void {
    trackAction?.('click');
    void runAction(
      `take:${ticketId}`,
      () => api.post(`/api/tickets/${ticketId}/transition`, { to: 'in_progress' }),
      'Задача взята в работу',
    ).then(() => setSelectedId(ticketId));
  }

  function saveResolution(): void {
    if (!detail) return;
    const text = resultText.trim();
    if (text === '') {
      setMessage({ text: 'Опишите, что сделано: заявитель увидит этот текст в чате', tone: 'error' });
      return;
    }
    void runAction(
      'resolve',
      () => api.post(`/api/tickets/${detail.ticket.id}/resolution`, { text }),
      'Результат отправлен заявителю на подтверждение',
    );
  }

  function openDeadline(): void {
    setDeadlineOpen(true);
    setDeadlineValue(defaultDeadlineInput(Date.now()));
    setDeadlineReason('');
    setMessage(null);
  }

  function submitDeadline(): void {
    if (!detail) return;
    const iso = deadlineInputToIso(deadlineValue);
    if (!iso || !reasonReady(deadlineReason)) return;
    setDeadlineOpen(false);
    void runAction(
      'extend',
      () =>
        api.post(`/api/tickets/${detail.ticket.id}/deadline`, {
          slaDueAt: iso,
          reason: deadlineReason.trim(),
        }),
      'Срок продлён — заявитель получит уведомление',
    );
  }

  function openReturn(): void {
    setReturnOpen(true);
    setReturnReason('');
    setMessage(null);
  }

  function submitReturn(): void {
    if (!detail || !reasonReady(returnReason)) return;
    setReturnOpen(false);
    void runAction(
      'return',
      () =>
        // API принимает только `{ to }`: причина в журнал не попадает (❓ нужен `reason` в TransitionInput).
        api.post(`/api/tickets/${detail.ticket.id}/transition`, {
          to: 'in_review',
          reason: returnReason.trim(),
        }),
      'Заявка возвращена диспетчеру',
    );
  }

  function toggleStep(key: string): void {
    trackAction?.('select');
    setCheckedSteps((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function openArticleInKb(query: string): void {
    trackAction?.('navigate');
    setTab('kb');
    setKbQuery(query);
  }

  function selectTask(ticketId: string): void {
    trackAction?.('select');
    setMessage(null);
    setRetry(null);
    setSelectedId(ticketId);
  }

  const tasksVisible = tasks;

  return (
    <main className="ed-page">
      <header className="ed-head" data-reveal>
        <div>
          <h1 className="ugra-page-title">{tab === 'tasks' ? 'Мои задачи' : 'База знаний'}</h1>
          <p className="ed-head__lead">
            {tab === 'tasks'
              ? 'Диагностика из базы знаний, запись результата и сроки по регламенту — на одном экране.'
              : 'Поиск своими словами: симптомы, модель устройства или код ошибки.'}
          </p>
        </div>
        <div className="ed-head__right">
          <div className="ed-switch ugra-liquid" role="tablist" aria-label="Разделы инженера">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tasks'}
              className={tab === 'tasks' ? 'ed-switch__tab ed-switch__tab--on' : 'ed-switch__tab'}
              onClick={() => setTab('tasks')}
            >
              Мои задачи
              <span className="ed-switch__count">{tasksVisible.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'kb'}
              className={tab === 'kb' ? 'ed-switch__tab ed-switch__tab--on' : 'ed-switch__tab'}
              onClick={() => setTab('kb')}
            >
              База знаний
            </button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={tasksLoading}
            onClick={() => {
              trackAction?.('click');
              void loadTasks();
              setDetailTick((value) => value + 1);
            }}
          >
            Обновить
          </Button>
        </div>
      </header>

      {tasksError && (
        <Card tone="danger" className="ed-error">
          <h2 className="ed-error__title">API не отвечает</h2>
          <p className="ugra-muted">{tasksError}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadTasks()}>
            Повторить
          </Button>
        </Card>
      )}

      {tab === 'tasks' ? (
        <div className="ed-layout">
          <Card padded={false} className="ed-list">
            <p className="ed-list__head">Сегодня · {tasksCountLabel(tasksVisible.length)}</p>

            {tasksLoading && tasksVisible.length === 0 && (
              <div className="ed-skeleton" aria-label="Загружаем задачи">
                <span className="ed-skeleton__line" />
                <span className="ed-skeleton__line ed-skeleton__line--short" />
                <span className="ed-skeleton__line" />
              </div>
            )}

            {!tasksLoading && tasksVisible.length === 0 && !tasksError && (
              <div className="ed-list__empty">
                <EmptyState
                  title="Задач на сегодня нет"
                  hint="Как только диспетчер назначит заявку, она появится здесь."
                  icon="✓"
                />
              </div>
            )}

            {tasksVisible.length > 0 && (
              <ul className="ed-list__items" aria-label="Задачи на сегодня" ref={tasksRef}>
                {tasksVisible.map((ticket) => {
                  const preview = previews[ticket.id];
                  const due = dueState(ticket.slaDueAt ?? ticket.reactDueAt, now);
                  const selected = ticket.id === selectedId;
                  return (
                    <li key={ticket.id} className={selected ? 'ed-task-row ed-task-row--on' : 'ed-task-row'}>
                      <button
                        type="button"
                        className="ed-task-row__main"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => selectTask(ticket.id)}
                      >
                        <span className="ed-task-row__top">
                          <span className="ed-task-row__num">№ {ticket.number}</span>
                          <span className={due ? `ed-due ed-due--${due.tone}` : 'ed-due'}>{due ? due.text : 'без срока'}</span>
                        </span>
                        <span className="ed-task-row__title">
                          {preview?.title ?? taskTitle(meta, ticket, [])}
                        </span>
                        <span className="ed-task-row__meta">
                          {preview?.place || 'место не указано'} · {formatTicketStatus(ticket.status)}
                        </span>
                        <span className="ed-task-row__foot">
                          <PriorityBars level={ticket.priority} />
                          {ticket.isEmergency && <Badge tone="danger">Авария</Badge>}
                        </span>
                      </button>
                      {ticket.status === 'assigned' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="ed-task-row__action"
                          loading={busy === `take:${ticket.id}`}
                          onClick={() => takeToWork(ticket.id)}
                        >
                          {ACTION_LABELS.take}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="ed-main">
            {!selectedId && !tasksLoading && (
              <Card>
                <EmptyState
                  title="Выберите задачу"
                  hint="Слева — задачи, назначенные вам на сегодня."
                  icon="→"
                />
              </Card>
            )}

            {selectedId && detailLoading && !detail && (
              <Card className="ed-skeleton-card">
                <span className="ed-skeleton__line" />
                <span className="ed-skeleton__line ed-skeleton__line--short" />
                <span className="ed-skeleton__line" />
              </Card>
            )}

            {selectedId && detailError && !detailLoading && (
              <Card tone="danger">
                <h2 className="ed-error__title">Не удалось открыть задачу</h2>
                <p className="ugra-muted">{detailError}</p>
                <Button variant="secondary" size="sm" onClick={() => setDetailTick((value) => value + 1)}>
                  Повторить
                </Button>
              </Card>
            )}

            {detail && (
              <>
                <Card hero className="ed-task">
                  <div className="ed-task__head">
                    <div className="ed-task__intro">
                      <p className="ed-label">
                        № {detail.ticket.number} · создана {formatDateTime(detail.ticket.createdAt)}
                      </p>
                      <h2 className="ed-task__title">{title}</h2>
                      <p className="ed-task__subtitle">
                        {place || 'Место не указано'}
                        {equipmentLabel ? ` · ${equipmentLabel}` : ''}
                      </p>
                    </div>
                    <div className="ed-task__due">
                      <span className="ed-label">Осталось по регламенту</span>
                      <span className={sla ? `ed-task__due-value ed-due--${sla.tone}` : 'ed-task__due-value'}>
                        {sla ? sla.text.replace('осталось ', '') : 'срок не задан'}
                      </span>
                    </div>
                  </div>

                  <div className="ed-task__facts">
                    <div>
                      <span className="ed-label">Заявитель</span>
                      <span className="ed-task__fact">{applicantName ?? 'не указан'}</span>
                    </div>
                    <div>
                      <span className="ed-label">Статус</span>
                      <span className="ed-task__fact">
                        <StatusBadge status={detail.ticket.status} />
                      </span>
                    </div>
                    <div>
                      <span className="ed-label">Оборудование</span>
                      <span className="ed-task__fact">{equipmentLabel || 'не указано'}</span>
                    </div>
                    <div>
                      <span className="ed-label">Исполнитель</span>
                      <span className="ed-task__fact">{assigneeName ?? 'не назначен'}</span>
                    </div>
                  </div>

                  <div className="ed-task__deadlines">
                    <span className="ed-deadline">Реакция: {formatDue(detail.ticket.reactDueAt)}</span>
                    <span className="ed-deadline">Решение: {formatDue(detail.ticket.slaDueAt)}</span>
                    {react?.overdue && <Badge tone="danger">Просрочена реакция</Badge>}
                  </div>

                  {actions.includes('take') && (
                    <div className="ed-task__cta">
                      <Button
                        variant="primary"
                        loading={busy === `take:${detail.ticket.id}`}
                        onClick={() => takeToWork(detail.ticket.id)}
                      >
                        {ACTION_LABELS.take}
                      </Button>
                    </div>
                  )}
                </Card>

                {message && (
                  <div className={`ed-note ed-note--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
                    <span>{message.text}</span>
                    {message.tone === 'error' && retry && (
                      <Button variant="secondary" size="sm" onClick={retry.run}>
                        Повторить
                      </Button>
                    )}
                  </div>
                )}

                <div className="ed-grid">
                  <Card className="ed-diag">
                    <h3 className="ed-card-title">Диагностика</h3>

                    {diagnostics.loading && (
                      <div className="ed-skeleton" aria-label="Ищем статью в базе знаний">
                        <span className="ed-skeleton__line" />
                        <span className="ed-skeleton__line ed-skeleton__line--short" />
                      </div>
                    )}

                    {!diagnostics.loading && diagnostics.error && (
                      <div className="ed-inline-error" role="alert">
                        <p>{diagnostics.error}</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDetailTick((value) => value + 1)}
                        >
                          Повторить
                        </Button>
                      </div>
                    )}

                    {!diagnostics.loading && !diagnostics.error && diagnosticArticle && (
                      <StepChecklist
                        article={diagnosticArticle}
                        checked={checkedSteps}
                        onToggle={toggleStep}
                      />
                    )}

                    {!diagnostics.loading && !diagnostics.error && !diagnosticArticle && (
                      <EmptyState
                        title={diagnosticQuery ? 'Статья не найдена' : 'Недостаточно данных'}
                        hint={
                          diagnosticQuery
                            ? 'Попробуйте найти решение в базе знаний вручную.'
                            : 'В заявке нет симптомов и оборудования — поиск по базе знаний не с чем сопоставить.'
                        }
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openArticleInKb(diagnosticQuery)}
                        >
                          Открыть базу знаний
                        </Button>
                      </EmptyState>
                    )}

                    {diagnosticArticle && (
                      <button
                        type="button"
                        className="ed-link"
                        onClick={() => openArticleInKb(diagnosticArticle.title)}
                      >
                        Открыть статью в базе знаний
                      </button>
                    )}
                  </Card>

                  <Card className="ed-similar">
                    <h3 className="ed-card-title">Похожие решённые</h3>

                    {diagnostics.loading && (
                      <div className="ed-skeleton" aria-label="Ищем похожие заявки">
                        <span className="ed-skeleton__line" />
                        <span className="ed-skeleton__line ed-skeleton__line--short" />
                      </div>
                    )}

                    {!diagnostics.loading && diagnostics.error && (
                      <div className="ed-inline-error" role="alert">
                        <p>Похожие заявки не загрузились</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDetailTick((value) => value + 1)}
                        >
                          Повторить
                        </Button>
                      </div>
                    )}

                    {!diagnostics.loading && !diagnostics.error && similar.length === 0 && (
                      <EmptyState
                        title="Похожих заявок нет"
                        hint="В базе знаний пока нет решённых обращений по этой проблеме."
                      />
                    )}

                    {similar.length > 0 && (
                      <ul className="ed-similar__list">
                        {similar.slice(0, 5).map((ticket) => {
                          const status = asTicketStatus(ticket.status);
                          return (
                            <li key={ticket.ticketId} className="ed-similar__item">
                              <div className="ed-similar__top">
                                <strong>№ {ticket.number}</strong>
                                {status ? <StatusBadge status={status} /> : <Badge tone="muted">{ticket.status}</Badge>}
                              </div>
                              <p className="ed-similar__text">{ticket.title}</p>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {recurring > 1 && (
                      <InsightBlock kind="action" title="Частая поломка устройства">
                        {recurring} {pluralRu(recurring, 'заявка', 'заявки', 'заявок')} по этому оборудованию
                        в базе знаний. Стоит проверить, не пора ли заменить устройство.
                      </InsightBlock>
                    )}
                  </Card>
                </div>

                <Card className="ed-result">
                  <h3 className="ed-card-title">Результат работы</h3>

                  {canResolve && (
                    <>
                      {quick.length > 0 && (
                        <div className="ed-quick" role="group" aria-label="Быстрые формулировки">
                          {quick.map((outcome) => (
                            <button
                              type="button"
                              key={outcome}
                              className="ed-chip"
                              onClick={() => {
                                trackAction?.('click');
                                setResultText((text) => appendOutcome(text, outcome));
                              }}
                            >
                              {outcome}
                            </button>
                          ))}
                        </div>
                      )}

                      <label className="ed-field">
                        <span className="ed-label">Что сделано</span>
                        <textarea
                          className="ed-textarea"
                          rows={3}
                          value={resultText}
                          placeholder="Что сделано — заявитель увидит это в своём чате"
                          onChange={(event) => {
                            setResultText(event.target.value);
                            trackAction?.('input');
                          }}
                        />
                      </label>

                      <div className="ed-result__actions">
                        <Button
                          variant="primary"
                          loading={busy === 'resolve'}
                          disabled={resultText.trim() === ''}
                          onClick={saveResolution}
                          title={resultText.trim() === '' ? 'Сначала опишите, что сделано' : 'Отправить результат заявителю'}
                        >
                          {ACTION_LABELS.resolve}
                        </Button>
                        <Button variant="secondary" onClick={openDeadline}>
                          {ACTION_LABELS.extend}
                        </Button>
                        <Button variant="secondary" onClick={openReturn}>
                          {ACTION_LABELS.return}
                        </Button>
                      </div>
                    </>
                  )}

                  {!canResolve && actions.includes('take') && (
                    <div className="ed-result__actions">
                      <p className="ugra-muted">
                        Возьмите задачу в работу — после этого появится запись результата.
                      </p>
                      <Button variant="secondary" onClick={openReturn}>
                        {ACTION_LABELS.return}
                      </Button>
                    </div>
                  )}

                  {actions.length === 0 && (
                    <div className="ed-done">
                      <strong>
                        {detail.ticket.status === 'resolved'
                          ? 'Выполнено, ждём заявителя'
                          : detail.ticket.status === 'closed'
                            ? 'Заявка закрыта'
                            : `Заявка в статусе «${formatTicketStatus(detail.ticket.status)}»`}
                      </strong>
                      <p>
                        {detail.ticket.resolution?.trim()
                          ? `Что сделано: ${detail.ticket.resolution.trim()}`
                          : 'Результат работы в заявке не записан.'}
                      </p>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="ed-kb">
          <Card className="ed-kb__search">
            <h2 className="ed-card-title">База знаний</h2>
            <SearchField
              value={kbQuery}
              onChange={(value) => {
                setKbQuery(value);
                trackAction?.('input');
              }}
              placeholder="Опишите симптом своими словами: «принтер не печатает»"
              label="Поиск по базе знаний"
              autoFocus
            />
          </Card>

          {kbState.error && (
            <Card tone="danger">
              <h2 className="ed-error__title">База знаний не отвечает</h2>
              <p className="ugra-muted">{kbState.error}</p>
              <Button variant="secondary" size="sm" onClick={() => setKbTick((value) => value + 1)}>
                Повторить
              </Button>
            </Card>
          )}

          {kbState.loading && (
            <Card className="ed-skeleton-card">
              <span className="ed-skeleton__line" />
              <span className="ed-skeleton__line ed-skeleton__line--short" />
            </Card>
          )}

          {!kbState.loading && kbQuery.trim().length < 2 && (
            <Card>
              <EmptyState
                title="Начните искать"
                hint="Опишите, что происходит с устройством: симптомы, модель, код ошибки."
                icon="⌕"
              />
            </Card>
          )}

          {!kbState.loading && kbQuery.trim().length >= 2 && kbArticles.length === 0 && !kbState.error && (
            <Card>
              <EmptyState
                title="Статья не найдена"
                hint="Попробуйте другие слова — модель устройства или код ошибки."
                icon="⌕"
              />
            </Card>
          )}

          {kbArticles.length > 0 && (
            <div className="ed-kb__layout">
              <Card padded={false} className="ed-kb__list">
                <p className="ed-list__head">
                  Найдено {kbArticles.length}{' '}
                  {pluralRu(kbArticles.length, 'статья', 'статьи', 'статей')}
                </p>
                <ul className="ed-kb__items" ref={kbRef}>
                  {kbArticles.map((article) => (
                    <li key={article.id}>
                      <button
                        type="button"
                        className={
                          kbArticle?.id === article.id ? 'ed-kb__item ed-kb__item--on' : 'ed-kb__item'
                        }
                        onClick={() => {
                          setKbArticleId(article.id);
                          trackAction?.('select');
                        }}
                      >
                        <span className="ed-kb__item-title">{article.title}</span>
                        {article.category && <span className="ed-kb__item-meta">{article.category}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>

              {kbArticle && (
                <ArticleCard article={kbArticle} checked={checkedSteps} onToggle={toggleStep} />
              )}
            </div>
          )}
        </div>
      )}

      <Modal
        open={deadlineOpen}
        title="Продлить срок"
        onClose={() => setDeadlineOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeadlineOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={busy === 'extend'}
              disabled={!deadlineInputToIso(deadlineValue) || !reasonReady(deadlineReason)}
              onClick={submitDeadline}
            >
              Продлить срок
            </Button>
          </>
        }
      >
        <div className="ed-form">
          <label className="ed-field">
            <span className="ed-label">Новый срок решения</span>
            <input
              type="datetime-local"
              className="ed-input"
              value={deadlineValue}
              onChange={(event) => setDeadlineValue(event.target.value)}
            />
          </label>
          <label className="ed-field">
            <span className="ed-label">Причина продления</span>
            <textarea
              className="ed-textarea"
              rows={3}
              value={deadlineReason}
              placeholder="Например: нужна запчасть, ожидаем поставку"
              onChange={(event) => setDeadlineReason(event.target.value)}
            />
          </label>
          <p className="ed-hint">Причина уйдёт заявителю в уведомлении. Без причины продлить нельзя.</p>
        </div>
      </Modal>

      <Modal
        open={returnOpen}
        title="Вернуть диспетчеру"
        onClose={() => setReturnOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={busy === 'return'}
              disabled={!reasonReady(returnReason)}
              onClick={submitReturn}
            >
              Вернуть диспетчеру
            </Button>
          </>
        }
      >
        <div className="ed-form">
          <label className="ed-field">
            <span className="ed-label">Причина возврата</span>
            <textarea
              className="ed-textarea"
              rows={3}
              value={returnReason}
              placeholder="Например: нужен доступ в серверную, у инженера нет прав"
              onChange={(event) => setReturnReason(event.target.value)}
            />
          </label>
          <p className="ed-hint">Диспетчер увидит причину и переназначит заявку.</p>
        </div>
      </Modal>
    </main>
  );
}
