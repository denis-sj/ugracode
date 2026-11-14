import { defineModule, type ModuleDeps } from '@ugra/core';
import { CallStore } from './calls';
import { createCallIntake, ensureCallApplicant } from './intake';
import { resolvePublicUrl } from './public-url';
import { RateLimiter, clientAddress } from './rate-limit';
import { EndInput, EndResponse, TurnInput, TurnResponse, createVoiceService, type VoiceService } from './service';
import { ActiveCallResponse, CallResponse, CallsResponse, PublicUrlResponse, toView } from './view';

export const VOICE_MODULE_ID = 'voice-call';

/** Новых звонков с одного адреса в минуту: жюри звонит по разу, бот — сотнями. */
export const CALLS_PER_MINUTE = 6;
/** Реплик с одного адреса в минуту: в звонке их не больше трёх, запас — на несколько звонков подряд. */
export const TURNS_PER_MINUTE = 30;

export interface VoiceRuntime {
  calls: CallStore;
  service: VoiceService;
  callLimit: RateLimiter;
  turnLimit: RateLimiter;
}

const runtimes = new WeakMap<ModuleDeps, VoiceRuntime>();

/** Одно состояние звонков на сервер: страница звонка пишет, экран диспетчера читает. */
export function voiceRuntime(deps: ModuleDeps): VoiceRuntime {
  const existing = runtimes.get(deps);
  if (existing) return existing;
  const now = (): number => deps.clock.now().getTime();
  const calls = new CallStore(() => deps.clock.now());
  const runtime: VoiceRuntime = {
    calls,
    service: createVoiceService({ llm: deps.ports.llm, calls, intake: createCallIntake(deps), clock: deps.clock }),
    callLimit: new RateLimiter(CALLS_PER_MINUTE, 60_000, now),
    turnLimit: new RateLimiter(TURNS_PER_MINUTE, 60_000, now),
  };
  runtimes.set(deps, runtime);
  return runtime;
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export default defineModule({
  id: VOICE_MODULE_ID,
  title: 'Звонок ИИ-оператору',
  enabledByDefault: true,
  routes(router, deps) {
    // Страница звонка открывается по QR без входа, поэтому `turn` и `end` — право `any`
    // с лимитом частоты по адресу; читать звонки может только диспетчер.
    router.post(
      '/turn',
      'any',
      async ({ body, headers }) => {
        const runtime = voiceRuntime(deps);
        const input = body as TurnInput;
        const address = clientAddress(headers);
        const isNew = runtime.calls.get(input.callId) === null;
        if (isNew && !runtime.callLimit.take(address)) throw httpError('Слишком много звонков, подождите минуту', 429);
        if (!runtime.turnLimit.take(address)) throw httpError('Слишком много реплик, подождите минуту', 429);
        return runtime.service.turn(input);
      },
      { body: TurnInput, response: TurnResponse },
    );
    router.post('/end', 'any', async ({ body }) => voiceRuntime(deps).service.end(body as EndInput), {
      body: EndInput,
      response: EndResponse,
    });
    router.get('/calls', 'tickets.queue', async () => ({ calls: voiceRuntime(deps).calls.list().map(toView) }), {
      response: CallsResponse,
    });
    router.get(
      '/calls/active',
      'tickets.queue',
      async () => {
        const active = voiceRuntime(deps)
          .calls.list()
          .find((call) => call.status === 'active');
        return { call: active ? toView(active) : null };
      },
      { response: ActiveCallResponse },
    );
    router.get(
      '/calls/:id',
      'tickets.queue',
      async ({ params }) => {
        const call = voiceRuntime(deps).calls.get(params.id ?? '');
        if (!call) throw httpError('Звонок не найден', 404);
        return { call: toView(call) };
      },
      { response: CallResponse },
    );
    router.get('/public-url', 'tickets.queue', async () => resolvePublicUrl(process.env), { response: PublicUrlResponse });
  },
  /** Заявитель для звонков: звонящий по QR не входит в систему. */
  async seed({ db }) {
    await ensureCallApplicant(db);
  },
});
