import './engineer-desk.css';
import type { Ticket, TicketListResponse, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  deadlineInputToIso,
  defaultDeadlineInput,
  dueState,
  equipmentName,
  groupSimilarTickets,
  myTasks,
  pickArticle,
  reasonReady,
  recurringEquipmentCount,
  solvedSimilar,
  sortMyTasks,
  stepKey,
  stepsToChecked,
  taskEquipment,
  taskPlace,
  taskTitle,
} from './format';
import type { ArticleStepsResponse, SimilarTicket } from './format';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { TaskActions } from './TaskActions';
import { TaskFolds } from './TaskFolds';
import { TaskHeader } from './TaskHeader';
import { TaskList } from './TaskList';
import { DeadlineModal, ReturnModal } from './TaskModals';
import { useDiagnostics } from './useDiagnostics';
import type { TaskPreview } from './types';

type MessageTone = 'ok' | 'error';

interface Message {
  text: string;
  tone: MessageTone;
}

/** Сколько задач подгружаем с полями для списка: остальные покажем по категории. */
const PREVIEW_LIMIT = 12;

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
    equipment: equipmentName(fields),
  };
}

/** Рабочее место инженера: задачи на сегодня, диагностика из базы, одно поле результата. */
export function EngineerDeskPage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const [tasks, setTasks] = useState<Ticket[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, TaskPreview>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => query.get('ticket'));

  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTick, setDetailTick] = useState(0);

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

  const preferredArticleId = useMemo(() => query.get('article'), [query]);
  const now = useNow(30_000);

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
        // Имя заявителя — подпись; без него карточка работает.
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    setResultText('');
    setCheckedSteps({});
  }, [selectedId]);

  // Отметки шагов статьи у заявки живут на сервере: чек-лист переживает перезагрузку.
  useEffect(() => {
    if (!selectedId) {
      setCheckedSteps({});
      return undefined;
    }
    let alive = true;
    api
      .get<ArticleStepsResponse>(`/api/m/knowledge/tickets/${encodeURIComponent(selectedId)}/steps`)
      .then((response) => {
        if (alive) setCheckedSteps(stepsToChecked(response.steps));
      })
      .catch(() => {
        // Без API чек-лист остаётся рабочим локально; сохранение покажет ошибку.
        if (alive) setCheckedSteps({});
      });
    return () => {
      alive = false;
    };
  }, [api, selectedId, detailTick]);

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

  const diagnostics = useDiagnostics(api, detail);

  const applicantName = useMemo(() => {
    const id = detail?.appeal.authorId;
    if (!id) return null;
    return users.find((candidate) => candidate.id === id)?.fullName ?? null;
  }, [detail, users]);

  const diagnosticArticle = useMemo(() => {
    const articles = diagnostics.state.data?.articles ?? [];
    if (preferredArticleId) {
      const preferred = articles.find((article) => article.id === preferredArticleId);
      if (preferred) return preferred;
    }
    return pickArticle(articles, diagnostics.query);
  }, [diagnostics.state.data, diagnostics.query, preferredArticleId]);

  const equipment = detail ? taskEquipment(detail.fields) : null;
  const equipmentLabel = equipmentName(detail?.fields ?? []);

  // Похожие заявки — все, кроме отменённых: решённых может не быть, но повтор проблемы виден.
  const similar = useMemo<SimilarTicket[]>(() => {
    const tickets = diagnostics.state.data?.tickets ?? [];
    return tickets.filter(
      (ticket) => ticket.ticketId !== detail?.ticket.id && ticket.status !== 'cancelled',
    );
  }, [detail?.ticket.id, diagnostics.state.data]);

  const solvedCount = useMemo(() => solvedSimilar(similar).length, [similar]);
  const similarGroups = useMemo(() => groupSimilarTickets(similar), [similar]);

  const recurring = useMemo(() => {
    const key = equipment?.equipment ?? '';
    if (!key || similar.length === 0) return 0;
    return recurringEquipmentCount(similar, `${key} ${equipment?.model ?? ''}`);
  }, [equipment, similar]);

  const title = detail ? taskTitle(meta, detail.ticket, detail.fields) : '';
  const place = detail ? taskPlace(meta, detail.fields) : '';
  const sla = detail
    ? dueState(detail.ticket.slaDueAt, now) ?? dueState(detail.ticket.reactDueAt, now)
    : null;
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
    trackAction?.('click');
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

  function toggleTaskStep(articleId: string, stepIndex: number): void {
    const ticketId = selectedId;
    if (!ticketId) return;
    trackAction?.('select');
    const key = stepKey(articleId, stepIndex);
    const previous = checkedSteps;
    const next = !previous[key];
    setCheckedSteps({ ...previous, [key]: next });
    api
      .post<{ step: { done: boolean } }>(
        `/api/m/knowledge/tickets/${encodeURIComponent(ticketId)}/steps`,
        { articleId, stepIndex, done: next },
      )
      .then((response) => {
        setCheckedSteps((current) => ({ ...current, [key]: response.step.done }));
      })
      .catch((cause: unknown) => {
        setCheckedSteps(previous);
        setMessage({ text: errorText(cause), tone: 'error' });
      });
  }

  function openKnowledgeSearch(text: string): void {
    trackAction?.('navigate');
    navigate(text === '' ? '/knowledge' : `/knowledge?q=${encodeURIComponent(text)}`);
  }

  function selectTask(ticketId: string): void {
    trackAction?.('select');
    setMessage(null);
    setRetry(null);
    setSelectedId(ticketId);
  }

  return (
    <main className="ed-page">
      {tasksError && (
        <Card tone="danger" className="ed-error">
          <h2 className="ed-error__title">API не отвечает</h2>
          <p className="ugra-muted">{tasksError}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadTasks()}>
            Повторить
          </Button>
        </Card>
      )}

      <div className="ed-layout">
        <aside className="ed-side">
          <TaskList
            tasks={tasks}
            previews={previews}
            selectedId={selectedId}
            now={now}
            loading={tasksLoading}
            onSelect={selectTask}
          />
        </aside>

        <div className="ed-main">
          {!selectedId && !tasksLoading && tasks.length === 0 && (
            <Card>
              <EmptyState
                title="Пока свободно"
                hint="Инструкции и решения из закрытых заявок остаются под рукой."
                icon="✓"
              >
                <Button variant="secondary" onClick={() => openKnowledgeSearch('')}>
                  Открыть базу знаний
                </Button>
              </EmptyState>
            </Card>
          )}

          {!selectedId && tasks.length > 0 && (
            <Card>
              <EmptyState title="Выберите задачу" hint="Слева — задачи, назначенные вам на сегодня." icon="→" />
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
              <Card hero className="ed-card">
                <TaskHeader
                  ticket={detail.ticket}
                  title={title}
                  place={place}
                  equipment={equipmentLabel}
                  applicantName={applicantName}
                  sla={sla}
                />

                <DiagnosticsPanel
                  article={diagnosticArticle}
                  checked={checkedSteps}
                  loading={diagnostics.state.loading}
                  error={diagnostics.state.error}
                  query={diagnostics.query}
                  onToggle={toggleTaskStep}
                  onRetry={diagnostics.retry}
                  onOpenSearch={openKnowledgeSearch}
                />

                {message && (
                  <div
                    className={`ed-note ed-note--${message.tone}`}
                    role={message.tone === 'error' ? 'alert' : 'status'}
                  >
                    <span>{message.text}</span>
                    {message.tone === 'error' && retry && (
                      <Button variant="secondary" size="sm" onClick={retry.run}>
                        Повторить
                      </Button>
                    )}
                  </div>
                )}

                <TaskActions
                  ticket={detail.ticket}
                  resultText={resultText}
                  busy={busy}
                  onResultChange={(value) => {
                    setResultText(value);
                    trackAction?.('input');
                  }}
                  onResolve={saveResolution}
                  onTake={() => takeToWork(detail.ticket.id)}
                  onExtend={openDeadline}
                  onReturn={openReturn}
                />
              </Card>

              <TaskFolds groups={similarGroups} solved={solvedCount} recurring={recurring} />
            </>
          )}
        </div>
      </div>

      <DeadlineModal
        open={deadlineOpen}
        value={deadlineValue}
        reason={deadlineReason}
        busy={busy === 'extend'}
        onValueChange={setDeadlineValue}
        onReasonChange={setDeadlineReason}
        onClose={() => setDeadlineOpen(false)}
        onSubmit={submitDeadline}
      />

      <ReturnModal
        open={returnOpen}
        reason={returnReason}
        busy={busy === 'return'}
        onReasonChange={setReturnReason}
        onClose={() => setReturnOpen(false)}
        onSubmit={submitReturn}
      />
    </main>
  );
}
