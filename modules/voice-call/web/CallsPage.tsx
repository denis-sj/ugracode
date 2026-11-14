import './voice.css';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, cx, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  CALLS_URL,
  POLL_MS,
  duration,
  formatPhone,
  pickCall,
  sourceLabel,
  statusText,
  type CallView,
} from './format';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Звонки с опросом раз в секунду; ошибка сети не стирает то, что уже на экране. */
function useCalls(api: WebPageProps['api']): { calls: CallView[]; error: string | null; loaded: boolean } {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api
        .get<{ calls: CallView[] }>(CALLS_URL)
        .then((response) => {
          if (!alive) return;
          setCalls(response.calls);
          setError(null);
          setLoaded(true);
        })
        .catch((reason: unknown) => {
          if (!alive) return;
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
  return { calls, error, loaded };
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
          <span className="voice-call__phone">{formatPhone(call.from)}</span>
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
            Заявка <b>{call.ticketNumber}</b> создана из разговора и разбирается тем же конвейером, что чат.
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
              <span className="voice-recent__phone">{formatPhone(call.from)}</span>
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

/** Экран «Входящий звонок»: реплики заявителя и ИИ появляются вживую, после звонка — ссылка на заявку. */
export function CallsPage({ api, navigate, trackAction }: WebPageProps): JSX.Element {
  const { calls, error, loaded } = useCalls(api);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = pickCall(calls, selectedId);
  const now = useNow(calls.some((call) => call.status === 'active'));

  return (
    <div className="voice-page">
      <header className="voice-head">
        <div>
          <h1>Входящий звонок</h1>
          <p className="voice-lead">
            ИИ-оператор отвечает на звонки на номер поддержки, задаёт одно-два уточнения и кладёт трубку — заявка уже в очереди.
          </p>
        </div>
        {error && <Badge tone="warn">Нет связи с сервером: {error}</Badge>}
      </header>

      {!loaded ? (
        <p className="voice-call__hint">Загружаем звонки…</p>
      ) : current ? (
        <div className="voice-layout">
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
          hint="Позвоните на номер поддержки или запустите симулятор: pnpm voice:sim. Звонок появится здесь сам."
        />
      )}
    </div>
  );
}
