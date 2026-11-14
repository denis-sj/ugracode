import type {
  CreateAppealResponse,
  PriorityLevel,
  RunStreamEvent,
  Ticket,
  TicketResponse,
  TicketStatus,
} from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, FieldRow, MicButton, flyToField, formatDateTime, tokenDuration } from '@ugra/ui';
import type { BadgeTone, WebPageProps } from '@ugra/ui';
import { fieldDrafts, missingQuestions, stepsFromEvents, stepsFromRuns } from './analysis';
import type { AnalysisStepView, DraftFieldView, MissingQuestionView, StepViewStatus } from './analysis';
import { QuestionCard } from './QuestionCard';

type Phase = 'idle' | 'sending' | 'analyzing' | 'ready' | 'failed';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: string;
}

const EXAMPLES: readonly string[] = [
  'В корпусе А, кабинет 312, не печатает принтер HP LaserJet — на экране замятие бумаги.',
  'Корпус Б, третий этаж: пропала сеть сразу у нескольких сотрудников, работа стоит.',
  'В кабинете 205 пахнет горелым и искрит розетка возле компьютера.',
];

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  emergency: 'Авария',
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Новая',
  ai_draft: 'Разбор ИИ',
  waiting_applicant: 'Ждёт ответа',
  in_review: 'На проверке',
  assigned: 'Назначена',
  in_progress: 'В работе',
  resolved: 'Решена',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function priorityTone(priority: PriorityLevel | null): BadgeTone {
  return priority ?? 'neutral';
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Чат заявителя: слева шаги разбора, в центре диалог, справа черновик заявки. */
export function ChatPage({ user, meta, api, trackAction }: WebPageProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<AnalysisStepView[]>([]);
  const [draft, setDraft] = useState<DraftFieldView[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<string[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [questions, setQuestions] = useState<MissingQuestionView[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const alive = useRef(true);
  const fieldRefs = useRef(new Map<string, HTMLDivElement>());
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      streamRef.current?.close();
    };
  }, []);

  const busy = phase === 'sending' || phase === 'analyzing';

  const addMessage = useCallback((role: ChatMessage['role'], text: string): void => {
    setMessages((previous) => [...previous, { id: nextId('msg'), role, text, at: nowIso() }]);
  }, []);

  const revealed = useMemo(
    () => draft.filter((field) => revealedKeys.includes(field.key)),
    [draft, revealedKeys],
  );
  const stillMissing = useMemo(() => draft.filter((field) => field.value === null), [draft]);
  const firstUserId = messages.find((message) => message.role === 'user')?.id;
  const currentQuestion = questions[questionIndex];
  const doneSteps = steps.filter((step) => step.status === 'done' || step.status === 'failed').length;
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const progress = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

  function resetRun(): void {
    streamRef.current?.close();
    streamRef.current = null;
    setSteps([]);
    setDraft([]);
    setRevealedKeys([]);
    setTicket(null);
    setQuestions([]);
    setQuestionIndex(0);
  }

  function collectStream(appealId: string): Promise<RunStreamEvent[]> {
    if (typeof EventSource === 'undefined') return Promise.resolve([]);
    return new Promise<RunStreamEvent[]>((resolve) => {
      const events: RunStreamEvent[] = [];
      let finished = false;
      let timer = 0;

      const source = new EventSource(`/api/appeals/${appealId}/stream`, { withCredentials: true });
      streamRef.current = source;

      const close = (): void => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        source.close();
        if (streamRef.current === source) streamRef.current = null;
        resolve(events);
      };

      timer = window.setTimeout(close, tokenDuration('slow') * 5);

      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as RunStreamEvent;
          events.push(parsed);
          if (parsed.type === 'run.completed' || parsed.type === 'run.failed') close();
        } catch {
          // некорректное событие не должно ломать разбор
        }
      };
      source.onerror = () => close();
    });
  }

  async function playSteps(planned: readonly AnalysisStepView[]): Promise<void> {
    if (planned.length === 0) return;
    setSteps(planned.map((step) => ({ ...step, status: 'pending' as StepViewStatus })));
    for (let index = 0; index < planned.length; index += 1) {
      const step = planned[index];
      if (!step) continue;
      setSteps((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, status: 'active' } : item)));
      await new Promise<void>((resolve) => window.setTimeout(resolve, tokenDuration('base') + 40));
      if (!alive.current) return;
      setSteps((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: step.status === 'failed' ? 'failed' : 'done' } : item,
        ),
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, tokenDuration('fast')));
    }
  }

  async function revealFields(fields: readonly DraftFieldView[], sourceText: string): Promise<void> {
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!field) continue;
      setRevealedKeys((previous) => (previous.includes(field.key) ? previous : [...previous, field.key]));
      await new Promise<void>((resolve) => window.setTimeout(resolve, tokenDuration('fast')));
      if (!alive.current) return;
      if (index < 6) {
        const target = fieldRefs.current.get(field.key);
        if (target && sourceRef.current) {
          void flyToField(sourceRef.current, target, {
            text: (field.quote ?? field.value ?? sourceText).slice(0, 42),
          });
        }
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, tokenDuration('base') / 2));
    }
  }

  async function submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    resetRun();
    setMessages([{ id: nextId('msg'), role: 'user', text: trimmed, at: nowIso() }]);
    setInput('');
    setPhase('sending');
    trackAction?.('system');
    addMessage('assistant', 'Принял обращение. Запускаю разбор — покажу каждый шаг, а поля появятся справа.');

    try {
      const created = await api.post<CreateAppealResponse>('/api/appeals', {
        text: trimmed,
        channel: 'chat',
        attachments: [],
      });
      if (!alive.current) return;
      setPhase('analyzing');

      const events = await collectStream(created.appealId);
      if (!alive.current) return;

      const detail = await api.get<TicketResponse>(`/api/tickets/${created.ticketId}`);
      if (!alive.current) return;

      const fromRuns = stepsFromRuns(detail.steps);
      await playSteps(fromRuns.length > 0 ? fromRuns : stepsFromEvents(events));
      if (!alive.current) return;

      const drafts = fieldDrafts(detail.fields, meta);
      setDraft(drafts);
      await revealFields(
        drafts.filter((field) => field.value !== null || field.needsReview),
        trimmed,
      );
      if (!alive.current) return;

      setTicket(detail.ticket);
      setQuestions(missingQuestions(detail.fields, meta));
      setPhase('ready');
      addMessage(
        'assistant',
        `Заявка ${detail.ticket.number} принята. Приоритет — ${PRIORITY_LABELS[detail.ticket.priority ?? 'medium']}. Диспетчер проверит поля и назначит исполнителя.`,
      );
    } catch (cause) {
      if (!alive.current) return;
      setPhase('failed');
      addMessage('assistant', `Не удалось отправить обращение: ${messageOf(cause)}. Проверьте соединение с API.`);
    }
  }

  function toggleRecording(): void {
    if (recording) {
      setRecording(false);
      setNote('Запись остановлена.');
      return;
    }
    setRecording(true);
    setNote('Слушаю… скажите проблему словами.');
    window.setTimeout(() => {
      if (!alive.current) return;
      setRecording(false);
      setNote('Голосовой ввод включится вместе с модулем «Входящий звонок».');
    }, tokenDuration('slow') * 4);
  }

  function answerQuestion(value: string | null): void {
    const question = questions[questionIndex];
    if (!question) return;
    trackAction?.('select');
    addMessage('user', value ?? 'Не знаю');
    addMessage(
      'assistant',
      value
        ? `Спасибо, записал: «${value}». Продолжим — уточнений может быть несколько.`
        : 'Понял. Это поле уйдёт диспетчеру с пометкой «на проверку».',
    );
    setQuestionIndex((previous) => previous + 1);
  }

  return (
    <div className="page chat">
      <header className="page__head">
        <div>
          <h1 className="page__title">Обращение в диспетчерскую</h1>
          <p className="page__lead">
            Опишите проблему словами — ИИ разберёт текст на глазах, соберёт заявку и задаст уточняющие вопросы.
          </p>
        </div>
        <div className="page__actions">
          <Badge tone="accent">{user.position}</Badge>
          <Badge tone={phase === 'ready' ? 'ok' : busy ? 'info' : 'neutral'} dot={busy}>
            {phase === 'ready' ? 'Заявка собрана' : busy ? 'Идёт разбор' : 'Готов принять'}
          </Badge>
        </div>
      </header>

      <div className="chat__grid">
        <aside className="chat__aside">
          <Card>
            <div className="chat__panel-title">
              <span>Разбор обращения</span>
              <span>
                {doneSteps}/{steps.length || '—'}
              </span>
            </div>
            <div className="chat__progress">
              <div className="chat__progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {steps.length === 0 && (
              <p className="ugra-dim">Шаги появятся, когда отправите обращение. Покажем каждый: от чтения текста до итога.</p>
            )}
            {failedSteps > 0 && (
              <p className="chat__hint">
                Не выполнено шагов: {failedSteps}. Заявка уйдёт диспетчеру с пометкой — данные не потеряются.
              </p>
            )}
            <div className="chat-steps">
              {steps.map((step) => (
                <div className={`chat-step chat-step--${step.status}`} key={step.id}>
                  <span className="chat-step__dot" aria-hidden="true">
                    {step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : step.status === 'active' ? '•' : '·'}
                  </span>
                  <span className="chat-step__body">
                    <span className="chat-step__title">{step.title}</span>
                    <span className="chat-step__hint">
                      {step.status === 'failed' ? `${step.hint} · не выполнен` : step.hint}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </aside>

        <Card className="chat__thread" padded={false}>
          <div className="chat__thread-head">
            <div>
              <h2 className="chat__panel-title">Чат с диспетчерской</h2>
              <span className="chat__hint">Отвечайте свободным текстом — вопросы придут карточками.</span>
            </div>
            <Badge tone="neutral">{user.fullName}</Badge>
          </div>

          <div className="chat__messages">
            {messages.length === 0 && (
              <div className="chat__hero">
                <span className="chat__hero-mark" aria-hidden="true">
                  ✳
                </span>
                <h2>Что случилось?</h2>
                <p className="ugra-muted">
                  Напишите как есть: что не работает, где и что видно на экране. Чем конкретнее — тем точнее заявка.
                </p>
                <div className="chat__examples">
                  {EXAMPLES.map((example) => (
                    <button
                      type="button"
                      className="chat-example"
                      key={example}
                      onClick={() => {
                        setInput(example);
                        trackAction?.('select');
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                className={`chat-msg chat-msg--${message.role === 'user' ? 'out' : message.role === 'assistant' ? 'in' : 'system'}`}
                key={message.id}
                ref={message.id === firstUserId ? sourceRef : undefined}
              >
                {message.role !== 'system' && (
                  <span className="chat-msg__author">{message.role === 'user' ? 'Вы' : 'Диспетчерская'}</span>
                )}
                <div className="chat-msg__bubble">{message.text}</div>
                <span className="chat-msg__time">{formatDateTime(message.at)}</span>
              </div>
            ))}

            {busy && (
              <div className="chat-msg chat-msg--in">
                <span className="chat-msg__author">Диспетчерская</span>
                <div className="chat-msg__bubble chat__typing" aria-label="Идёт разбор">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            {currentQuestion && phase === 'ready' && (
              <QuestionCard
                key={currentQuestion.key}
                question={currentQuestion}
                index={questionIndex}
                total={questions.length}
                onAnswer={answerQuestion}
              />
            )}
          </div>

          <form
            className="chat__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(input);
            }}
          >
            <textarea
              className="chat__input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit(input);
                }
              }}
              placeholder="Например: в корпусе А, кабинет 312, принтер не печатает — замятие бумаги."
              rows={3}
              disabled={busy}
              aria-label="Текст обращения"
            />
            <div className="chat__composer-row">
              <MicButton onRecord={toggleRecording} recording={recording} disabled={busy} />
              <span className="chat__hint">{note ?? 'Enter — отправить, Shift+Enter — новая строка'}</span>
              <span className="ugra-spacer" />
              <Button type="submit" variant="primary" loading={phase === 'sending'} disabled={!input.trim() || busy}>
                Отправить
              </Button>
            </div>
          </form>
        </Card>

        <Card className="chat__draft">
          <div className="chat__draft-head">
            <h2>Черновик заявки</h2>
            <Badge tone={revealed.length > 0 ? 'accent' : 'muted'}>{revealed.length} полей</Badge>
          </div>

          {ticket && (
            <div className="chat-receipt ugra-rise">
              <div className="chat-receipt__head">
                <span className="chat-receipt__number">№ {ticket.number}</span>
                <Badge tone={priorityTone(ticket.priority)}>{PRIORITY_LABELS[ticket.priority ?? 'medium']}</Badge>
              </div>
              <div className="chat-receipt__meta">Заявка принята · {STATUS_LABELS[ticket.status]}</div>
              <div className="chat-receipt__line">
                <span>Срок реакции</span>
                <span>{formatDateTime(ticket.reactDueAt)}</span>
              </div>
              <div className="chat-receipt__line">
                <span>Срок решения</span>
                <span>{formatDateTime(ticket.slaDueAt)}</span>
              </div>
            </div>
          )}

          {revealed.length === 0 && !ticket && (
            <div className="chat__draft-empty">
              Поля появятся по ходу разбора: значение, уверенность, цитата и откуда оно взялось.
            </div>
          )}

          <div className="chat__draft-list">
            {revealed.map((field) => (
              <FieldRow
                key={field.key}
                fieldKey={field.key}
                label={field.label}
                value={field.value}
                confidence={field.confidence}
                quote={field.quote}
                quoteSource="обращение"
                origin={field.origin}
                needsReview={field.needsReview}
                rowRef={(element) => {
                  if (element) fieldRefs.current.set(field.key, element);
                  else fieldRefs.current.delete(field.key);
                }}
              />
            ))}
          </div>

          {stillMissing.length > 0 && phase === 'ready' && (
            <p className="chat__hint">
              Ещё спросим: {stillMissing.slice(0, 4).map((field) => field.label.toLowerCase()).join(', ')}
              {stillMissing.length > 4 ? '…' : ''}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
