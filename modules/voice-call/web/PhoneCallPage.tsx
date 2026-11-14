import './voice.css';
import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, cx, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  GREETING,
  LINE_SILENCE,
  MAX_CALL_SECONDS,
  SILENCE_TIMEOUT_MS,
  THINKING_SAY,
  appendLine,
  detectDevice,
  isMissingUser,
  modeNote,
  phaseLabel,
  pickRussianVoice,
  sessionUserIds,
  shouldAutoFinish,
  ticketLabel,
  timerText,
  type CallMode,
  type CallPhase,
  type EndReply,
  type TranscriptLine,
  type TurnReply,
} from './call-flow';

/* ---------- Web Speech API: типы есть не во всех браузерах и не в lib.dom ---------- */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}
interface SpeechResults {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
interface SpeechEvent {
  readonly resultIndex: number;
  readonly results: SpeechResults;
}
interface SpeechErrorEvent {
  readonly error?: string;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

/** `SpeechRecognition` в Chrome/Android, `webkitSpeechRecognition` в Safari; Firefox — нет. */
function recognitionConstructor(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `call-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Phone-down, чтобы красная кнопка читалась без подписи. */
function HangupIcon(): JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.2 14.4c4.6-3.2 10.9-3.2 15.6 0l1.2-2.6c-5.6-4-12.6-4-18 0l1.2 2.6Z"
        fill="currentColor"
      />
      <path d="M9 15.2 7.4 19M15 15.2l1.6 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AnswerIcon(): JSX.Element {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 3.8c.6-.4 1.4-.2 1.8.4l1.8 2.8c.4.6.3 1.3-.1 1.8l-1 1.2c-.2.3-.2.6 0 .9 1.2 2 2.8 3.6 4.8 4.8.3.2.6.2.9 0l1.2-1c.5-.4 1.2-.5 1.8-.1l2.8 1.8c.6.4.8 1.2.4 1.8l-1.3 2c-.5.8-1.4 1.3-2.3 1.1C9.8 19.2 4.8 14.2 3.7 6.4c-.2-.9.3-1.8 1.1-2.3l1.8-.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Кольца вызова: единственная бесконечная анимация страницы вместе с «ИИ думает». */
function Rings({ live }: { live: boolean }): JSX.Element {
  return (
    <div className={cx('call__rings', live && 'call__rings--live')} aria-hidden="true">
      <span className="call__ring" />
      <span className="call__ring" />
      <span className="call__ring" />
      <span className="call__avatar">ИИ</span>
    </div>
  );
}

function LevelBars(): JSX.Element {
  return (
    <span className="call__level" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export interface PhoneCallPageProps {
  api: WebPageProps['api'];
}

/**
 * Публичная страница `/call` — «входящий вызов» на телефоне жюри (QR).
 *
 * Разговор целиком в браузере: распознаёт `SpeechRecognition` (ru-RU), озвучивает `speechSynthesis`,
 * на сервер уходит только текст. Без распознавания или микрофона — то же окно с полем ввода.
 */
export function PhoneCallPage({ api }: PhoneCallPageProps): JSX.Element {
  const [phase, setPhase] = useState<CallPhase>('incoming');
  const [mode, setMode] = useState<CallMode>('voice');
  const [micDenied, setMicDenied] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phaseRef = useRef<CallPhase>('incoming');
  const linesRef = useRef<TranscriptLine[]>([]);
  const callIdRef = useRef('');
  const fromRef = useRef('Телефон');
  const activeRef = useRef(false);
  const finishedRef = useRef(false);
  const unlockedRef = useRef(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micFailedRef = useRef(false);
  /** `startListening` объявлен ниже `sendTurn`: зовём его через ref, чтобы не ловить TDZ. */
  const listenRef = useRef<() => void>(() => undefined);
  const listRef = useRef<HTMLOListElement | null>(null);
  useListMotion(listRef, lines.length > 0);

  const go = (next: CallPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  };

  const pushLine = (speaker: TranscriptLine['speaker'], text: string): void => {
    linesRef.current = appendLine(linesRef.current, speaker, text);
    setLines(linesRef.current);
  };

  /** iOS говорит только после жеста: «разблокируем» синтез в обработчике нажатия «Ответить». */
  const unlockSpeech = (): void => {
    if (unlockedRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      warm.lang = 'ru-RU';
      synth.speak(warm);
      unlockedRef.current = true;
    } catch {
      /* синтез недоступен — разговор пойдёт субтитрами */
    }
  };

  const speak = (text: string): Promise<void> =>
    new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || text.trim() === '' || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      let timer = 0;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        resolve();
      };
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ru-RU';
      utterance.rate = 1;
      utterance.pitch = 1;
      const voice = pickRussianVoice(synth.getVoices());
      if (voice) {
        const match = synth.getVoices().find((item) => item.lang === voice.lang && item.name === voice.name);
        if (match) utterance.voice = match;
      }
      utterance.onend = finish;
      utterance.onerror = finish;
      // Страховка: если onend не придёт (вкладка в фоне), разговор не замирает.
      timer = window.setTimeout(finish, Math.max(4000, text.length * 120));
      synth.speak(utterance);
    });

  const stopListening = (): void => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setInterim('');
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.abort();
    } catch {
      /* уже остановлено */
    }
  };

  const finishCall = async (): Promise<void> => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    activeRef.current = false;
    stopListening();
    window.speechSynthesis?.cancel();
    go('thinking');
    const transcript = linesRef.current.filter((line) => line.text !== LINE_SILENCE);
    try {
      const reply = await api.post<EndReply>('/api/m/voice-call/end', {
        callId: callIdRef.current,
        from: fromRef.current,
        transcript,
      });
      setTicketId(reply.ticketId);
      setTicketNumber(reply.ticketNumber);
      if (reply.say.trim() !== '') pushLine('ai', reply.say);
      go('ended');
      void speak(reply.say);
    } catch (reason) {
      setError(errorText(reason));
      go('failed');
    }
  };

  const sendTurn = async (text: string): Promise<void> => {
    if (!activeRef.current) return;
    pushLine('caller', text);
    go('thinking');
    try {
      const reply = await api.post<TurnReply>('/api/m/voice-call/turn', {
        callId: callIdRef.current,
        from: fromRef.current,
        text,
      });
      setEmergency(reply.emergency);
      pushLine('ai', reply.say);
      if (!activeRef.current) return;
      if (reply.done) {
        await finishCall();
        return;
      }
      go('speaking');
      await speak(reply.say);
      if (!activeRef.current) return;
      if (micFailedRef.current) {
        setMode('text');
        go('waiting_input');
        return;
      }
      listenRef.current();
    } catch (reason) {
      if (!activeRef.current) return;
      // Сервер отказал (например, лимит частоты): досылаем то, что уже сказано, и создаём заявку.
      setError(errorText(reason));
      await finishCall();
    }
  };

  const startListening = (): void => {
    if (!activeRef.current) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setMode('text');
      go('waiting_input');
      return;
    }
    stopListening();
    go('listening');
    setInterim('');
    let finalText = '';
    let silence = 0;
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    const armSilence = (): void => {
      window.clearTimeout(silence);
      silence = window.setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          /* уже остановлено */
        }
      }, SILENCE_TIMEOUT_MS);
    };
    recognition.onresult = (event) => {
      let live = '';
      let done = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result?.[0];
        if (!result || !alternative) continue;
        if (result.isFinal) done += ` ${alternative.transcript}`;
        else live += alternative.transcript;
      }
      finalText = `${finalText}${done}`.trim();
      setInterim(live.trim());
      armSilence();
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micFailedRef.current = true;
        setMicDenied(true);
        setMode('text');
      }
    };
    recognition.onend = () => {
      window.clearTimeout(silence);
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setInterim('');
      if (!activeRef.current) return;
      void sendTurn(finalText.trim());
    };
    try {
      recognition.start();
      armSilence();
    } catch {
      // iOS иногда не даёт начать распознавание без нового жеста — не подвешиваем разговор.
      recognitionRef.current = null;
      setMode('text');
      go('waiting_input');
    }
  };
  listenRef.current = startListening;

  /** Нажатие «Ответить» — единственный жест: микрофон, разблокировка синтеза, гостевой вход. */
  const answer = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    go('connecting');
    callIdRef.current = createCallId();
    fromRef.current = detectDevice(navigator.userAgent);
    activeRef.current = true;
    finishedRef.current = false;
    unlockedRef.current = false;
    micFailedRef.current = false;
    setSeconds(0);
    setTicketId(null);
    setTicketNumber(null);
    unlockSpeech();

    let mic = false;
    try {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic = true;
      }
    } catch {
      mic = false;
    }
    // Микрофон нужен был только как жест и проверка доступа: дальше слушает SpeechRecognition.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    let sessionError: unknown = null;
    for (const userId of sessionUserIds()) {
      try {
        await api.post('/api/session', { userId });
        sessionError = null;
        break;
      } catch (reason) {
        sessionError = reason;
        // Нет такого пользователя (старая база без сида модуля) — пробуем общего гостя.
        if (!isMissingUser(reason)) break;
      }
    }
    if (sessionError) {
      activeRef.current = false;
      setError(`Не удалось войти гостем: ${errorText(sessionError)}. На сервере нужен pnpm seed.`);
      go('failed');
      setBusy(false);
      return;
    }
    setBusy(false);

    pushLine('ai', GREETING);
    go('speaking');
    await speak(GREETING);
    if (!activeRef.current) return;
    if (!mic || !recognitionConstructor()) {
      setMicDenied(!mic);
      setMode('text');
      go('waiting_input');
      return;
    }
    startListening();
  };

  const submitText = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || !activeRef.current) return;
    if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return;
    setDraft('');
    void sendTurn(text);
  };

  const hangup = (): void => {
    if (phaseRef.current === 'incoming') return;
    void finishCall();
  };

  // Таймер разговора идёт только пока звонок жив.
  useEffect(() => {
    const live = phase !== 'incoming' && phase !== 'ended' && phase !== 'failed';
    if (!live) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 90 с — серверный лимит: заканчиваем сами, чтобы человек не говорил в пустоту.
  useEffect(() => {
    if (activeRef.current && shouldAutoFinish(seconds)) void finishCall();
  }, [seconds]);

  // Ушли со страницы — гасим микрофон и синтез, чтобы телефон не «звонил» в кармане.
  useEffect(
    () => () => {
      activeRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try {
        recognition?.abort();
      } catch {
        /* уже остановлено */
      }
      window.speechSynthesis?.cancel();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  // Новые субтитры — прокрутка вниз, как в мессенджере.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines, interim]);

  const live = phase === 'listening' || phase === 'speaking' || phase === 'thinking';
  const callActive = phase !== 'incoming' && phase !== 'ended' && phase !== 'failed';

  if (phase === 'ended') {
    return (
      <div className={cx('call', 'call--ended')}>
        <div className="call__bg" aria-hidden="true" />
        <main className="call__stage">
          <span className="call__badge-ok">✓</span>
          <h1 className="call__ended-title">Звонок завершён</h1>
          {ticketId ? (
            <>
              <p className="call__ended-label">Заявка</p>
              <p className="call__ticket" aria-live="polite">
                {ticketLabel(ticketNumber)}
              </p>
              <p className="call__ended-hint">Диспетчер уже видит её в очереди и разбирает обращение.</p>
            </>
          ) : (
            <>
              <p className="call__ended-hint">Обращение не создано: в разговоре не было ни одной фразы.</p>
              <p className="call__ended-hint">Перезвоните и опишите проблему — или напишите диспетчеру.</p>
            </>
          )}
          <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
            Позвонить снова
          </Button>
        </main>
        <footer className="call__foot">
          <p className="call__note">{modeNote(mode, micDenied)}</p>
        </footer>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className={cx('call', 'call--failed')}>
        <div className="call__bg" aria-hidden="true" />
        <main className="call__stage">
          <span className="call__badge-fail">!</span>
          <h1 className="call__ended-title">Звонок прервался</h1>
          <p className="call__ended-hint">{error ?? 'Сервер не ответил. Проверьте связь и попробуйте ещё раз.'}</p>
          <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
            Попробовать снова
          </Button>
        </main>
        <footer className="call__foot">
          <p className="call__note">Если не получается — напишите диспетчеру в чат поддержки.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className={cx('call', `call--${phase}`, emergency && 'call--emergency')}>
      <div className="call__bg" aria-hidden="true" />
      <header className="call__brand">
        <span className="call__logo">1+∞</span>
        <span className="call__brand-text">Диспетчерская с ИИ</span>
      </header>

      <main className="call__stage">
        <Rings live={live} />
        <h1 className="call__name">ИИ-диспетчер</h1>
        <p className="call__status" aria-live="polite">
          {phase === 'thinking' ? (
            <>
              {THINKING_SAY}
              <span className="call__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </>
          ) : (
            phaseLabel(phase)
          )}
          {phase === 'listening' && <LevelBars />}
        </p>
        {callActive && (
          <p className="call__timer" aria-label="Длительность разговора">
            {timerText(seconds)}
            {seconds >= MAX_CALL_SECONDS - 10 && <span className="call__timer-warn"> · заканчиваем</span>}
          </p>
        )}

        {lines.length > 0 && (
          <ol className="call__lines" ref={listRef} aria-live="polite" aria-label="Субтитры разговора">
            {lines.slice(-8).map((line, index) => (
              <li key={`${line.speaker}-${index}-${line.text.slice(0, 12)}`} className={cx('call__line', `call__line--${line.speaker}`)}>
                <span className="call__line-who">{line.speaker === 'caller' ? 'Вы' : 'ИИ'}</span>
                <p className="call__line-text">{line.text}</p>
              </li>
            ))}
            {interim !== '' && (
              <li className="call__line call__line--caller call__line--interim">
                <span className="call__line-who">Вы</span>
                <p className="call__line-text">{interim}</p>
              </li>
            )}
          </ol>
        )}

        {phase === 'incoming' && (
          <div className="call__actions">
            <button type="button" className="call__answer" onClick={() => void answer()} disabled={busy} aria-label="Ответить">
              <AnswerIcon />
            </button>
            <span className="call__action-label">Ответить</span>
          </div>
        )}

        {callActive && (
          <div className="call__actions call__actions--hangup">
            <button type="button" className="call__hangup" onClick={hangup} aria-label="Завершить">
              <HangupIcon />
            </button>
            <span className="call__action-label">Завершить</span>
          </div>
        )}

        {activeRef.current && (phase === 'waiting_input' || mode === 'text') && phase !== 'thinking' && (
          <form className="call__form" onSubmit={submitText}>
            <label className="call__form-label" htmlFor="call-text">
              Что случилось?
            </label>
            <div className="call__form-row">
              <input
                id="call-text"
                className="call__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Например: не печатает принтер в 312-м"
                autoComplete="off"
                maxLength={500}
                enterKeyHint="send"
              />
              <Button type="submit" variant="primary" disabled={draft.trim() === ''}>
                Отправить
              </Button>
            </div>
          </form>
        )}

        {error && phase !== 'thinking' && <p className="call__error">{error}</p>}
      </main>

      <footer className="call__foot">
        <p className="call__note">{modeNote(mode, micDenied)}</p>
        {phase === 'incoming' && <p className="call__tiny">Нажмите «Ответить» — браузер спросит доступ к микрофону.</p>}
      </footer>
    </div>
  );
}

export default PhoneCallPage;
