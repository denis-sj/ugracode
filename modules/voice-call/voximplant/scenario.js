/*
 * VoxEngine-сценарий «ИИ-оператор диспетчерской» (задача 036).
 *
 * Voximplant сам распознаёт и синтезирует речь (Яндекс SpeechKit). На наш API уходит только текст:
 *   POST {API_URL}{TURN_PATH} {callId, from, text}            → {say, done, emergency, turn}
 *   POST {API_URL}{END_PATH}  {callId, from, transcript[]}    → {ticketId, ticketNumber, say}
 * Заголовок X-Voice-Secret = VOXIMPLANT_WEBHOOK_SECRET из .env сервера.
 *
 * Как вставить в кабинет — modules/voice-call/README.md. Значения ниже заменяются ТОЛЬКО в копии
 * сценария в кабинете Voximplant; в репозиторий секрет не кладём.
 */
/* global setTimeout, clearTimeout, Modules, VoxEngine, VoiceList, ASRProfileList, Net, CallEvents, ASREvents, AppEvents, Logger */
// Сценарий исполняет VoxEngine, а не Node: модуль ASR подключается его собственным require.
// eslint-disable-next-line no-undef, @typescript-eslint/no-require-imports
require(Modules.ASR);

const API_URL = '__PUBLIC_API_URL__'; // например https://ugra.example.ru — без слэша в конце
const VOICE_SECRET = '__VOXIMPLANT_WEBHOOK_SECRET__';
const TURN_PATH = '/api/m/voice-call/turn';
const END_PATH = '/api/m/voice-call/end';

const VOICE = VoiceList.Yandex.Neural.ru_RU_alena;
const ASR_PROFILE = ASRProfileList.Yandex.ru_RU;

const GREETING =
  'Здравствуйте! Диспетчерская ИТ-поддержки. Звонок записывается и обрабатывается искусственным интеллектом. ' +
  'Расскажите, что случилось и где вы находитесь.';
const FILLER = 'Секунду, записываю.';
const FALLBACK_QUESTION = 'Уточните, пожалуйста, кабинет и как с вами связаться.';
const FALLBACK_FAREWELL = 'Спасибо, обращение записано. Диспетчер свяжется с вами. До свидания.';

const SERVER_TIMEOUT_S = 6; // дольше — говорим запасной вопрос
const LISTEN_TIMEOUT_MS = 10000; // заявитель молчит — отправляем пустую реплику
const MAX_CALLER_TURNS = 3;
const MAX_CALL_MS = 90000;

let call = null;
let callId = '';
let from = '';
let turns = 0;
let finished = false;
const transcript = [];

function post(path, body) {
  return Net.httpRequestAsync(API_URL + path, {
    method: 'POST',
    headers: ['Content-Type: application/json', 'X-Voice-Secret: ' + VOICE_SECRET],
    postData: JSON.stringify(body),
    timeout: SERVER_TIMEOUT_S,
  }).then(function (res) {
    if (res.code !== 200) throw new Error('HTTP ' + res.code);
    return JSON.parse(res.text);
  });
}

/** Синтез фразы; промис завершается, когда фраза договорена (или звонок оборвался). */
function say(text) {
  return new Promise(function (resolve) {
    if (!call || finished === 'hangup') return resolve();
    const done = function () {
      call.removeEventListener(CallEvents.PlaybackFinished, done);
      resolve();
    };
    call.addEventListener(CallEvents.PlaybackFinished, done);
    call.say(text, { language: VOICE });
    transcript.push({ speaker: 'ai', text: text });
  });
}

/** Одна фраза заявителя: новое распознавание на каждую реплику, пусто — если промолчал. */
function listen() {
  return new Promise(function (resolve) {
    const asr = VoxEngine.createASR({ profile: ASR_PROFILE, singleUtterance: true });
    let settled = false;
    const finish = function (text) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      call.stopMediaTo(asr);
      asr.stop();
      resolve(text || '');
    };
    const timer = setTimeout(function () {
      finish('');
    }, LISTEN_TIMEOUT_MS);
    asr.addEventListener(ASREvents.Result, function (e) {
      finish(e.text);
    });
    asr.addEventListener(ASREvents.ASRError, function () {
      finish('');
    });
    call.sendMediaTo(asr);
  });
}

function end(reason) {
  if (finished) return Promise.resolve(null);
  finished = reason;
  return post(END_PATH, { callId: callId, from: from, transcript: transcript }).catch(function (err) {
    Logger.write('voice end failed: ' + err);
    return null;
  });
}

function hangup() {
  if (call) call.hangup();
  VoxEngine.terminate();
}

async function dialog() {
  await say(GREETING);
  while (!finished && turns < MAX_CALLER_TURNS) {
    const text = await listen();
    if (finished) return;
    turns += 1;
    transcript.push({ speaker: 'caller', text: text });
    // Заполнитель звучит, пока сервер думает; ответ сервера ждём параллельно.
    const filler = text ? say(FILLER) : Promise.resolve();
    let reply;
    try {
      reply = await post(TURN_PATH, { callId: callId, from: from, text: text });
    } catch (err) {
      Logger.write('voice turn failed: ' + err);
      reply = { say: FALLBACK_QUESTION, done: turns >= MAX_CALLER_TURNS, emergency: false };
    }
    await filler;
    if (finished) return;
    await say(reply.say);
    if (reply.done) break;
  }
  const result = await end('done');
  await say((result && result.say) || FALLBACK_FAREWELL);
  hangup();
}

VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
  call = e.call;
  callId = e.sessionId ? String(e.sessionId) : String(Date.now());
  from = e.callerid || 'anonymous';
  call.addEventListener(CallEvents.Connected, function () {
    setTimeout(function () {
      // Лимит длительности: дальше не слушаем, заявку собираем из сказанного.
      end('timeout').then(function (result) {
        say((result && result.say) || FALLBACK_FAREWELL).then(hangup);
      });
    }, MAX_CALL_MS);
    dialog().catch(function (err) {
      Logger.write('voice dialog failed: ' + err);
      end('error').then(hangup);
    });
  });
  call.addEventListener(CallEvents.Disconnected, function () {
    // Заявитель положил трубку раньше: заявку всё равно создаём из того, что успел сказать.
    end('hangup').then(function () {
      VoxEngine.terminate();
    });
  });
  call.answer();
});
