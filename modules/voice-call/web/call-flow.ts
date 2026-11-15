/**
 * Чистые функции страницы звонка `/call`: их проверяют тесты, компонент только показывает результат.
 * Здесь нет DOM, микрофона и синтеза речи — только тексты, подписи и арифметика.
 */

/** Фазы разговора: от входящего вызова до номера заявки на экране. */
export type CallPhase =
  | 'incoming'
  | 'connecting'
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'waiting_input'
  | 'ended'
  | 'failed';

export type CallMode = 'voice' | 'text';

export interface TranscriptLine {
  speaker: 'caller' | 'ai';
  text: string;
}

/** Ответ `POST /api/m/voice-call/turn` (схема — `server/service.ts`). */
export interface TurnReply {
  say: string;
  done: boolean;
  emergency: boolean;
  turn: number;
}

/** Ответ `POST /api/m/voice-call/end`. */
export interface EndReply {
  ticketId: string | null;
  ticketNumber: string | null;
  say: string;
}

/** Гостевой заявитель звонка: создаётся сидом модуля и лежит в `data/users.json`. */
export const GUEST_USER_ID = 'u-call-guest';
/** Запасной вход: общий демо-гость. Нужен, если база создана старым сидом без `u-call-guest`. */
export const FALLBACK_GUEST_ID = 'guest';

/** Кем входить странице звонка: сначала свой гость, затем общий — чтобы демо не падало на старой базе. */
export function sessionUserIds(): readonly string[] {
  return [GUEST_USER_ID, FALLBACK_GUEST_ID];
}

/** 404 от `POST /api/session`: такого пользователя в базе нет, пробуем следующего. */
export function isMissingUser(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

export const GREETING = 'Здравствуйте, это ИИ-диспетчер. Разговор обрабатывает ИИ. Опишите, пожалуйста, проблему.';
export const GREETING_REPEAT = 'Здравствуйте! Опишите, что случилось и в каком вы кабинете.';
export const LINE_SILENCE = '— тишина —';
/** Пока ждём сервер: живому человеку пауза кажется вечностью. */
export const THINKING_SAY = 'Секунду, записываю…';
export const LISTEN_SAY = 'Слушаю…';
export const SPEAK_SAY = 'ИИ-диспетчер говорит';
export const CONNECT_SAY = 'Соединяем с ИИ-диспетчером…';
/** Типовые уточнения ИИ: синтезируем заранее, чтобы вопрос звучал без паузы. */
export const CALL_CLARIFICATIONS: readonly string[] = [
  'В каком корпусе и кабинете?',
  'Что именно не работает?',
  'Уточните, пожалуйста, что сломалось.',
];
/** Что готовим голосом по жесту «Ответить»: приветствие, «секунду» и типовые уточнения. */
export const CALL_PREFETCH: readonly string[] = [GREETING, THINKING_SAY, ...CALL_CLARIFICATIONS];
/** Тишина в микрофоне: через 8 с отправляем пустую реплику, ИИ переспросит. */
export const SILENCE_TIMEOUT_MS = 8000;
/** Дольше 90 с сервер сам заканчивает разговор — предупреждаем за 10 с. */
export const MAX_CALL_SECONDS = 90;
export const CALL_WARNING_SECONDS = 10;

export const VOICE_NOTE = 'Говорите обычной фразой — ИИ ответит голосом. Речь распознаёт браузер, текст уходит на сервер для ответа.';
export const TEXT_NOTE = 'Браузер не слышит речь — напишите текстом. ИИ ответит голосом, если синтез доступен.';
export const MIC_DENIED_NOTE = 'Нет доступа к микрофону — напишите текстом, диспетчер получит заявку.';

/** Подпись устройства в карточке диспетчера: «iPhone», «Android», «Компьютер», «Телефон». */
export function detectDevice(userAgent: string): string {
  if (/iphone|ipod/i.test(userAgent)) return 'iPhone';
  if (/ipad/i.test(userAgent)) return 'iPad';
  if (/android/i.test(userAgent)) return 'Android';
  if (/macintosh|windows|linux|x11|cros/i.test(userAgent)) return 'Компьютер';
  return 'Телефон';
}

/** Секунды → «м:сс»; отрицательное и NaN — «0:00». */
export function timerText(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** QR ведёт на `/call`: страницу показываем и по чистому пути, и по hash-маршруту. */
export function isCallPath(pathname: string, hash: string): boolean {
  const normalize = (raw: string): string => raw.trim().replace(/\/+$/, '') || '/';
  if (normalize(pathname) === '/call') return true;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [hashPath = ''] = raw.split('?');
  return normalize(hashPath) === '/call';
}

export interface VoiceLike {
  lang: string;
  name?: string;
}

/** Русский голос синтеза: первый `ru-*`, иначе браузер возьмёт голос по умолчанию. */
export function pickRussianVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  return voices.find((voice) => voice.lang.toLowerCase().startsWith('ru')) ?? null;
}

/** Новая строка разговора для субтитров; пробелы схлопываем, чтобы не рябило. */
export function appendLine(lines: readonly TranscriptLine[], speaker: TranscriptLine['speaker'], text: string): TranscriptLine[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  return [...lines, { speaker, text: clean === '' ? LINE_SILENCE : clean }];
}

/** Подпись фазы под аватаром. */
export function phaseLabel(phase: CallPhase): string {
  switch (phase) {
    case 'incoming':
      return 'Входящий вызов';
    case 'connecting':
      return CONNECT_SAY;
    case 'speaking':
      return SPEAK_SAY;
    case 'listening':
      return LISTEN_SAY;
    case 'thinking':
      return THINKING_SAY;
    case 'waiting_input':
      return 'Ждём ваш текст';
    case 'ended':
      return 'Звонок завершён';
    case 'failed':
      return 'Звонок прервался';
  }
}

/** Подсказка под субтитрами: голосом или текстом идёт разговор. */
export function modeNote(mode: CallMode, micDenied: boolean): string {
  if (mode === 'text') return micDenied ? MIC_DENIED_NOTE : TEXT_NOTE;
  return VOICE_NOTE;
}

/** Пора ли закончить разговор самим: сервер не даст дольше 90 с. */
export function shouldAutoFinish(seconds: number): boolean {
  return seconds >= MAX_CALL_SECONDS;
}

/** Крупный номер заявки для финального экрана: «З-20261114-0001» → «З-20261114-0001» (null без заявки). */
export function ticketLabel(ticketNumber: string | null): string {
  return ticketNumber && ticketNumber.trim() !== '' ? ticketNumber : 'без номера';
}
