import { defineModule, type ModuleDeps } from '@ugra/core';
import { CallStore } from './calls';
import { createCallIntake, ensurePhoneCaller, type AnalyzeAppeal } from './intake';
import { createVoiceService, type VoiceService } from './service';
import { CallResponse, CallsResponse, toView } from './view';

export const VOICE_MODULE_ID = 'voice-call';

export interface VoiceRuntime {
  calls: CallStore;
  service: VoiceService;
}

let runtime: VoiceRuntime | null = null;
let runtimeDeps: ModuleDeps | null = null;

/**
 * Одно состояние звонков на процесс: вебхук Voximplant пишет, экран диспетчера читает.
 * Новые `deps` (другой сервер в тестах) — новое состояние.
 */
export function voiceRuntime(deps: ModuleDeps, analyze: AnalyzeAppeal | null = null, timeoutMs?: number): VoiceRuntime {
  if (runtime && runtimeDeps === deps) return runtime;
  const calls = new CallStore(() => deps.clock.now());
  const service = createVoiceService({
    llm: deps.ports.llm,
    calls,
    intake: createCallIntake(deps, analyze),
    clock: deps.clock,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  runtime = { calls, service };
  runtimeDeps = deps;
  return runtime;
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

export default defineModule({
  id: VOICE_MODULE_ID,
  title: 'Звонок на номер: ИИ-оператор',
  enabledByDefault: true,
  events: [],
  routes(router, deps) {
    router.get(
      '/calls',
      'tickets.queue',
      async () => ({ calls: voiceRuntime(deps).calls.list().map(toView) }),
      { response: CallsResponse },
    );
    router.get(
      '/calls/:id',
      'tickets.queue',
      async ({ params }) => {
        const call = voiceRuntime(deps).calls.get(params.id ?? '');
        if (!call) throw notFound('Звонок не найден');
        return { call: toView(call) };
      },
      { response: CallResponse },
    );
  },
  /** Заявитель для звонков: номер в профиле пока не хранится, контакт пишется в чат обращения. */
  async seed({ db }) {
    await ensurePhoneCaller(db);
  },
});
