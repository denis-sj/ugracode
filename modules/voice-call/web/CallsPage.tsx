import './voice.css';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Badge, Button, Card, EmptyState, cx, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  CALLS_URL,
  POLL_MS,
  PUBLIC_URL_POLL_MS,
  PUBLIC_URL_URL,
  callUrlOf,
  callerLabel,
  duration,
  findNewCall,
  pickCall,
  sourceLabel,
  statusText,
  type CallView,
  type PublicUrlView,
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

/** Публичный адрес страницы звонка: туннель меняет его при каждом запуске — спрашиваем раз в 15 с. */
function usePublicUrl(api: WebPageProps['api']): { value: PublicUrlView | null; failed: boolean } {
  const [value, setValue] = useState<PublicUrlView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api
        .get<PublicUrlView>(PUBLIC_URL_URL)
        .then((response) => {
          if (!alive) return;
          setValue(response);
          setFailed(false);
        })
        .catch(() => {
          if (!alive) return;
          setFailed(true);
        });
    };
    load();
    const timer = setInterval(load, PUBLIC_URL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);
  return { value, failed };
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

/** QR на `/call`: жюри сканирует со слайда и звонит со своего телефона. */
function CallQr({ value, failed }: { value: PublicUrlView | null; failed: boolean }): JSX.Element {
  const [image, setImage] = useState<string | null>(null);
  const callUrl = callUrlOf(value);

  useEffect(() => {
    if (!callUrl) {
      setImage(null);
      return undefined;
    }
    let alive = true;
    QRCode.toDataURL(callUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0f1222', light: '#ffffff' } })
      .then((data) => {
        if (alive) setImage(data);
      })
      .catch(() => {
        if (alive) setImage(null);
      });
    return () => {
      alive = false;
    };
  }, [callUrl]);

  return (
    <Card className="voice-qr" as="aside">
      <h2 className="voice-qr__title">Позвонить ИИ-диспетчеру</h2>
      {image ? (
        <img className="voice-qr__image" src={image} alt={`QR-код на страницу звонка ${callUrl ?? ''}`} width={236} height={236} />
      ) : (
        <div className="voice-qr__empty" aria-hidden="true">
          QR
        </div>
      )}
      {callUrl ? (
        <>
          <code className="voice-qr__url">{callUrl}</code>
          <p className="voice-qr__note">
            Наведите камеру телефона и нажмите «Ответить». {value?.source === 'tunnel' ? 'Адрес туннеля живёт, пока запущен pnpm demo:tunnel.' : 'Адрес взят из PUBLIC_WEB_URL.'}
          </p>
        </>
      ) : (
        <p className="voice-qr__hint">
          {failed ? 'Сервер не отдал адрес.' : 'Публичного адреса пока нет.'} Запустите <code>pnpm demo:tunnel</code> — адрес и QR появятся здесь сами. На этом
          ноутбуке звонок работает и по <code>localhost:5173/call</code>.
        </p>
      )}
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

/** Экран «Входящий звонок»: QR для жюри, реплики ИИ вживую, после звонка — ссылка на заявку. */
export function CallsPage({ api, navigate, trackAction }: WebPageProps): JSX.Element {
  const { calls, error, loaded } = useCalls(api);
  const publicUrl = usePublicUrl(api);
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
            Жюри сканирует QR и говорит с ИИ-оператором со своего телефона: ИИ отвечает голосом, задаёт одно-два уточнения и кладёт трубку —
            заявка уже в очереди.
          </p>
        </div>
        {error && <Badge tone="warn">Нет связи с сервером: {error}</Badge>}
      </header>

      <div className="voice-layout voice-layout--calls">
        <div className="voice-layout__main">
          {!loaded ? (
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
              hint="Покажите QR справа: жюри сканирует его и нажимает «Ответить». Или проверьте без телефона — pnpm voice:sim."
            />
          )}
        </div>
        <CallQr value={publicUrl.value} failed={publicUrl.failed} />
      </div>
    </div>
  );
}
