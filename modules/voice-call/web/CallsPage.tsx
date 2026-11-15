import { shortTicketNumber } from '@ugra/contracts';
import './voice.css';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, cx, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  CALLS_URL,
  POLL_MS,
  callerLabel,
  duration,
  findNewCall,
  pickCall,
  sourceLabel,
  statusText,
  type CallView,
} from './format';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Звонки с опросом раз в секунду; ошибка сети не стирает то, что уже на экране. */
interface CallsState {
  calls: CallView[];
  error: string | null;
  forbidden: boolean;
  loaded: boolean;
  updatedAt: number | null;
}

function useCalls(api: WebPageProps['api']): CallsState {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api
        .get<{ calls: CallView[] }>(CALLS_URL)
        .then((response) => {
          if (!alive) return;
          setCalls(response.calls);
          setError(null);
          setForbidden(false);
          setLoaded(true);
          setUpdatedAt(Date.now());
        })
        .catch((reason: unknown) => {
          if (!alive) return;
          const status = (reason as { status?: number }).status;
          setForbidden(status === 401 || status === 403);
          setError(errorText(reason));
          setLoaded(true);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);
  return { calls, error, forbidden, loaded, updatedAt };
}

/** Короткий звук вызова. WebAudio требует жеста: контекст создаём на первом клике диспетчера. */
function useRinger(): () => void {
  const contextRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = (): void => {
      if (contextRef.current) return;
      try {
        contextRef.current = new AudioContext();
      } catch {
        /* WebAudio нет — плашка всё равно появится */
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
  return useCallback((): void => {
    const context = contextRef.current;
    if (!context) return;
    void context
      .resume()
      .then(() => {
        const start = context.currentTime;
        for (const offset of [0, 0.45]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(880, start + offset);
          oscillator.frequency.setValueAtTime(660, start + offset + 0.18);
          gain.gain.setValueAtTime(0.0001, start + offset);
          gain.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.34);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start + offset);
          oscillator.stop(start + offset + 0.36);
        }
      })
      .catch(() => undefined);
  }, []);
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Transcript({ call }: { call: CallView }): JSX.Element {
  const listRef = useRef<HTMLOListElement | null>(null);
  useListMotion(listRef, call.lines.length > 0);
  const waiting = call.status === 'active' && call.lines.at(-1)?.speaker === 'caller';
  return (
    <ol className="voice-transcript" ref={listRef} aria-live="polite">
      {call.lines.map((line, index) => {
        const label = sourceLabel(line);
        return (
          <li key={`${line.at}-${index}`} className={cx('voice-line', `voice-line--${line.speaker}`, line.source === 'fallback' && 'voice-line--fallback')}>
            <span className="voice-line__who">{line.speaker === 'caller' ? 'Заявитель' : 'ИИ-оператор'}</span>
            <p className="voice-line__text">{line.text === '' ? '— молчание —' : line.text}</p>
            {label && <span className="voice-line__meta">{label}</span>}
          </li>
        );
      })}
      {waiting && (
        <li className="voice-line voice-line--ai voice-line--typing" aria-label="ИИ думает">
          <span className="voice-line__who">ИИ-оператор</span>
          <span className="voice-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </li>
      )}
    </ol>
  );
}

function CallCard({ call, now, onOpenTicket }: { call: CallView; now: number; onOpenTicket: (id: string) => void }): JSX.Element {
  const active = call.status === 'active';
  return (
    <Card className="voice-call" tone={call.emergency ? 'danger' : active ? 'accent' : 'default'} hero={active}>
      <header className="voice-call__head">
        <div className={cx('voice-call__icon', active && 'voice-call__icon--live')} aria-hidden="true">
          ☎
        </div>
        <div className="voice-call__who">
          <span className="voice-call__phone">{callerLabel(call.from)}</span>
          <span className="voice-call__status">{statusText(call)}</span>
        </div>
        <div className="voice-call__badges">
          {call.emergency && (
            <Badge tone="emergency" dot>
              Авария
            </Badge>
          )}
          <Badge tone={active ? 'ok' : 'neutral'} dot={active}>
            {active ? 'В эфире' : 'Завершён'}
          </Badge>
          <span className="voice-call__timer" title="Длительность звонка">
            {duration(call, now)}
          </span>
        </div>
      </header>

      {call.lines.length === 0 ? (
        <p className="voice-call__hint">ИИ-оператор поздоровался и слушает заявителя…</p>
      ) : (
        <Transcript call={call} />
      )}

      {call.ticketId && (
        <footer className="voice-call__foot" data-reveal>
          <span>
            Заявка <b>{shortTicketNumber(call.ticketNumber ?? '')}</b> создана из разговора и разбирается тем же конвейером, что чат.
          </span>
          <Button onClick={() => call.ticketId && onOpenTicket(call.ticketId)}>Открыть заявку</Button>
        </footer>
      )}
    </Card>
  );
}

function RecentCalls({ calls, currentId, now, onSelect }: { calls: CallView[]; currentId: string | null; now: number; onSelect: (id: string) => void }): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  useListMotion(listRef, calls.length > 0);
  return (
    <Card className="voice-recent" as="aside">
      <h2 className="voice-recent__title">Звонки за смену</h2>
      <ul className="voice-recent__list" ref={listRef}>
        {calls.map((call) => (
          <li key={call.id}>
            <button
              type="button"
              className={cx('voice-recent__item', call.id === currentId && 'voice-recent__item--current')}
              onClick={() => onSelect(call.id)}
            >
              <span className="voice-recent__phone">{callerLabel(call.from)}</span>
              <span className="voice-recent__meta">
                {statusText(call)} · {duration(call, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function IncomingBanner({ call, onOpen, onClose }: { call: CallView; onOpen: () => void; onClose: () => void }): JSX.Element {
  return (
    <div className="voice-incoming" role="alert">
      <span className="voice-incoming__icon" aria-hidden="true">
        ☎
      </span>
      <span className="voice-incoming__text">
        <b>Входящий звонок</b>
        <span className="voice-incoming__meta">{callerLabel(call.from)} · ИИ-оператор уже отвечает</span>
      </span>
      <Button variant="primary" onClick={onOpen}>
        Открыть
      </Button>
      <button type="button" className="voice-incoming__close" aria-label="Скрыть плашку" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** Реплики ИИ вживую и созданная из разговора заявка. */
export function CallsPage({ api, navigate, trackAction }: WebPageProps): JSX.Element {
  const { calls, error, forbidden, loaded, updatedAt } = useCalls(api);
  const ring = useRinger();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<CallView | null>(null);
  const previousRef = useRef<CallView[]>([]);
  const current = pickCall(calls, selectedId);
  const now = useNow(calls.some((call) => call.status === 'active'));

  // Новый активный звонок всплывает сам: плашка с анимацией и коротким звуком.
  useEffect(() => {
    const fresh = findNewCall(previousRef.current, calls);
    previousRef.current = calls;
    if (!fresh) return undefined;
    setIncoming(fresh);
    ring();
    const timer = setTimeout(() => setIncoming(null), 8000);
    return () => clearTimeout(timer);
  }, [calls, ring]);

  return (
    <div className="voice-page">
      {incoming && (
        <IncomingBanner
          call={incoming}
          onOpen={() => {
            trackAction?.('select');
            setSelectedId(incoming.id);
            setIncoming(null);
          }}
          onClose={() => setIncoming(null)}
        />
      )}

      <header className="voice-head">
        <div>
          <h1>Входящий звонок</h1>
          <p className="voice-lead">
            Разговоры с ИИ-оператором, расшифровки и созданные заявки обновляются в реальном времени.
          </p>
        </div>
        {forbidden ? (
          <Badge tone="warn">Нет доступа к звонкам: войдите диспетчером</Badge>
        ) : error ? (
          <Badge tone="warn">Нет связи с сервером: {error}</Badge>
        ) : (
          loaded && (
            <span className="voice-live" title="Экран опрашивает звонки раз в секунду">
              <i className="voice-live__dot" aria-hidden="true" />
              обновляется вживую
              {updatedAt !== null && (
                <span className="voice-live__time">{new Date(updatedAt).toLocaleTimeString('ru-RU')}</span>
              )}
            </span>
          )
        )}
      </header>

      <div className="voice-layout voice-layout--calls">
        <div className="voice-layout__main">
          {forbidden ? (
            <EmptyState
              icon="☎"
              title="Нужен вход диспетчером"
              hint="Звонки видит только диспетчер: выберите Анну Миронову на экране входа и откройте вкладку «Звонок» снова."
            />
          ) : !loaded ? (
            <p className="voice-call__hint">Загружаем звонки…</p>
          ) : current ? (
            <div className="voice-stack">
              <CallCard
                call={current}
                now={now}
                onOpenTicket={(id) => {
                  trackAction?.('navigate');
                  navigate(`/review?id=${encodeURIComponent(id)}`);
                }}
              />
              {calls.length > 1 && (
                <RecentCalls
                  calls={calls}
                  currentId={current.id}
                  now={now}
                  onSelect={(id) => {
                    trackAction?.('select');
                    setSelectedId(id);
                  }}
                />
              )}
            </div>
          ) : (
            <EmptyState
              icon="☎"
              title="Звонков пока нет"
              hint="Здесь появится разговор, когда сотрудник позвонит ИИ-оператору."
            />
          )}
        </div>
      </div>
    </div>
  );
}
