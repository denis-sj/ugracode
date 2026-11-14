import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CreateAppealResponse, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import { formatDue } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { AskCard } from './AskCard';
import { TicketSticker } from './TicketSticker';
import {
  buildAiSummary,
  buildQuestions,
  clampIndex,
  fieldValues,
  parseEmphasis,
  type AnswerMap,
} from './format';
import { useVoiceInput } from './useVoiceInput';

interface ChatMessage {
  id: string;
  from: 'me' | 'ai';
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Экран «Обращение» (4.1): старт «Что случилось?» → чат → карточки-вопросы → стикер справа. */
export function ChatPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [started, setStarted] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [ownText, setOwnText] = useState('');
  const [composerText, setComposerText] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finalShown, setFinalShown] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const messageId = useRef(0);
  const lastText = useRef('');
  const sendingRef = useRef(false);
  const answeringRef = useRef(false);

  const nextMessageId = (): string => {
    messageId.current += 1;
    return `m-${messageId.current}`;
  };

  useEffect(() => {
    let alive = true;
    api
      .get<UsersResponse>('/api/users')
      .then((response) => {
        if (alive) setUsers(response.users);
      })
      .catch(() => {
        // Имена инженеров — подсказка; без них стикер и чат работают.
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const scrollToEnd = useCallback((): void => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, busy, ownText, scrollToEnd]);

  const values = useMemo(() => (ticket ? fieldValues(ticket.fields, answers) : {}), [ticket, answers]);
  const answeredKeys = useMemo(() => new Set(Object.keys(answers)), [answers]);
  const questions = useMemo(
    () => buildQuestions(meta.fields, meta.dictionaries, values, answeredKeys),
    [meta.fields, meta.dictionaries, values, answeredKeys],
  );
  const safeIndex = clampIndex(questionIndex, questions.length);
  const question = questions[safeIndex] ?? null;

  const refreshTicket = useCallback(
    async (id: string): Promise<TicketResponse | null> => {
      try {
        const detail = await api.get<TicketResponse>(`/api/tickets/${id}`);
        setTicket(detail);
        return detail;
      } catch {
        return null;
      }
    },
    [api],
  );

  const sendText = useCallback(
    async (raw: string, echo: boolean): Promise<void> => {
      const text = raw.trim();
      if (text === '' || sendingRef.current) return;
      sendingRef.current = true;
      lastText.current = text;
      setError(null);
      setSending(true);
      setStarted(true);
      setBusy('Разбираю обращение');
      const sentAttachments = [...attachments];
      if (echo) {
        setMessages((previous) => [...previous, { id: nextMessageId(), from: 'me', text }]);
        setComposerText('');
        setAttachments([]);
      }
      const minimumThinking = sleep(700);
      try {
        const created = await api.post<CreateAppealResponse>('/api/appeals', {
          text,
          channel: 'chat',
          attachments: sentAttachments,
        });
        const detail = await api.get<TicketResponse>(`/api/tickets/${created.ticketId}`);
        await minimumThinking;
        setTicket(detail);
        setAnswers({});
        setQuestionIndex(0);
        setFinalShown(false);
        const summary = buildAiSummary({
          fields: fieldValues(detail.fields, {}),
          fieldsMeta: meta.fields,
          dictionaries: meta.dictionaries,
        });
        setMessages((previous) => [...previous, { id: nextMessageId(), from: 'ai', text: summary }]);
        trackAction?.('system');
      } catch (caught) {
        await minimumThinking;
        setError(`Не удалось отправить обращение: ${errorText(caught)}`);
      } finally {
        setBusy(null);
        setSending(false);
        sendingRef.current = false;
      }
    },
    [api, attachments, meta.dictionaries, meta.fields, sending, trackAction],
  );

  const answerQuestion = useCallback(
    async (value: string | null, label: string): Promise<void> => {
      if (!question || busy || answeringRef.current) return;
      answeringRef.current = true;
      const key = question.key;
      setMessages((previous) => [...previous, { id: nextMessageId(), from: 'me', text: label }]);
      setAnswers((previous) => ({ ...previous, [key]: value }));
      setOwnText('');
      setQuestionIndex(0);
      trackAction?.('select');

      const existing = ticket?.fields.find((field) => field.fieldKey === key);
      if (ticket && existing && value !== null) {
        setBusy('Обновляю заявку');
        try {
          await api.patch(`/api/tickets/${ticket.ticket.id}/fields/${key}`, { value });
          await refreshTicket(ticket.ticket.id);
        } catch {
          // Модуль уточнений ещё не создал поле на сервере — ответ уже виден в стикере.
        }
      } else {
        setBusy('Пересобираю заявку');
      }
      await sleep(450);
      setBusy(null);
      answeringRef.current = false;
    },
    [api, busy, question, refreshTicket, ticket, trackAction],
  );

  const voice = useVoiceInput(
    api,
    (text) => setComposerText((previous) => (previous.trim() === '' ? text : `${previous} ${text}`)),
    (message) => setError(message),
  );

  // Цифры клавиатуры выбирают вариант, стрелки листают вопросы; набор текста не перехватываем.
  useEffect(() => {
    if (!question) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const digit = Number.parseInt(event.key, 10);
      const option = Number.isNaN(digit) ? undefined : question.options[digit - 1];
      if (option) {
        event.preventDefault();
        void answerQuestion(option.value, option.label);
        return;
      }
      if (digit === question.options.length + 1) {
        event.preventDefault();
        void answerQuestion(null, 'Не знаю — диспетчер уточнит сам');
        return;
      }
      if (event.key === 'ArrowLeft') setQuestionIndex(clampIndex(safeIndex - 1, questions.length));
      if (event.key === 'ArrowRight') setQuestionIndex(clampIndex(safeIndex + 1, questions.length));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answerQuestion, question, questions.length, safeIndex]);

  // Финальная реплика, когда все вопросы заданы. Стикер в ленту не пишется.
  useEffect(() => {
    if (!ticket || !started || finalShown || busy || questions.length > 0) return;
    setFinalShown(true);
    const assignee = ticket.ticket.assigneeId
      ? users.find((candidate) => candidate.id === ticket.ticket.assigneeId)
      : undefined;
    const text = assignee
      ? `Готово: заявка **№ ${ticket.ticket.number}** назначена. Инженер **${assignee.fullName}** придёт ${formatDue(
          ticket.ticket.slaDueAt,
        )}.`
      : `Готово: заявка **№ ${ticket.ticket.number}** собрана и ушла диспетчеру. Он проверит детали и назначит инженера.`;
    setMessages((previous) => [...previous, { id: nextMessageId(), from: 'ai', text }]);
  }, [busy, finalShown, questions.length, started, ticket, users]);

  const submitComposer = (): void => {
    void sendText(composerText, true);
  };

  const retry = (): void => {
    if (lastText.current !== '') void sendText(lastText.current, false);
  };

  const composerRows = started ? 1 : 4;

  return (
    <div className={started ? 'chat-page' : 'chat-page chat-page--start'}>
      <div className="chat-page__grid" aria-hidden="true" />
      <div className="chat-main">
        {!started && (
          <div className="chat-hero">
            <h1 className="chat-hero__title">Что случилось?</h1>
            <p className="chat-hero__lead">Опишите своими словами — я разберу обращение и соберу заявку.</p>
          </div>
        )}

        <div className="chat-thread" ref={threadRef} aria-live="polite">
          {messages.map((message) =>
            message.from === 'me' ? (
              <div className="chat-me ugra-rise" key={message.id}>
                {message.text}
              </div>
            ) : (
              <div className="chat-ai ugra-rise" key={message.id}>
                {parseEmphasis(message.text).map((segment, index) =>
                  segment.strong ? (
                    <strong key={index}>{segment.text}</strong>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </div>
            ),
          )}

          {busy && (
            <div className="chat-think" role="status">
              {busy}
            </div>
          )}

          {question && !busy && (
            <AskCard
              question={question}
              index={safeIndex}
              total={questions.length}
              ownText={ownText}
              onOwnText={setOwnText}
              onAnswer={(value, label) => void answerQuestion(value, label)}
              onUnknown={() => void answerQuestion(null, 'Не знаю — диспетчер уточнит сам')}
              onSkip={() => void answerQuestion(null, 'Пропустил вопрос')}
              onPrev={() => setQuestionIndex(clampIndex(safeIndex - 1, questions.length))}
              onNext={() => setQuestionIndex(clampIndex(safeIndex + 1, questions.length))}
            />
          )}

          {error && (
            <div className="chat-error" role="alert">
              <span>{error}</span>
              <button type="button" className="chat-error__retry" onClick={retry}>
                Повторить
              </button>
            </div>
          )}

          <div className="chat-thread__end" />
        </div>

        <div className="chat-composer-wrap">
          {attachments.length > 0 && (
            <div className="chat-attachments">
              {attachments.map((name) => (
                <span className="chat-attachment" key={name}>
                  <span className="chat-attachment__name">{name}</span>
                  <button
                    type="button"
                    className="chat-attachment__remove"
                    aria-label={`Убрать ${name}`}
                    onClick={() => setAttachments((previous) => previous.filter((item) => item !== name))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitComposer();
            }}
          >
            <label className="chat-visually-hidden" htmlFor="chat-input">
              Опишите проблему
            </label>
            <textarea
              id="chat-input"
              className="chat-composer__input"
              rows={composerRows}
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitComposer();
                }
              }}
              placeholder={
                started
                  ? 'Напишите сообщение'
                  : 'Например: в 312 кабинете не печатает принтер HP, горит оранжевая лампочка'
              }
            />
            <div className="chat-composer__row">
              <input
                ref={fileRef}
                type="file"
                className="chat-visually-hidden"
                multiple
                onChange={(event) => {
                  const names = Array.from(event.target.files ?? []).map((file) => file.name);
                  if (names.length > 0) setAttachments((previous) => [...previous, ...names]);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                className="chat-composer__icon"
                aria-label="Прикрепить файл"
                title="Прикрепить файл"
                onClick={() => fileRef.current?.click()}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path
                    d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={
                  voice.recording ? 'chat-composer__icon chat-composer__icon--rec' : 'chat-composer__icon'
                }
                aria-label={voice.recording ? 'Остановить запись' : 'Сказать голосом'}
                title={
                  voice.supported
                    ? voice.recording
                      ? 'Остановить запись'
                      : 'Сказать голосом'
                    : 'Запись голоса недоступна в этом браузере'
                }
                onClick={voice.toggle}
                disabled={!voice.supported || voice.transcribing || sending}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <rect
                    x="9"
                    y="3"
                    width="6"
                    height="11"
                    rx="3"
                    fill={voice.recording ? 'currentColor' : 'none'}
                  />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                </svg>
              </button>
              <a
                className="chat-composer__icon"
                href="tel:+73462000000"
                aria-label="Позвонить диспетчеру"
                title="Позвонить диспетчеру"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path
                    d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <button
                type="submit"
                className="chat-composer__send"
                aria-label="Отправить"
                disabled={composerText.trim() === '' || sending}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      {ticket && (
        <TicketSticker
          className="chat-sticker--inline"
          detail={ticket}
          meta={meta}
          users={users}
          answers={answers}
        />
      )}
    </div>
  );
}
