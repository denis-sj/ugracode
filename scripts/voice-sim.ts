import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPorts } from '@ugra/adapters';
import { MemoryStore } from '@ugra/core';
import { z } from 'zod';
import { loadReferenceData } from '../apps/api/src/data';
import { buildServer } from '../apps/api/src/server';
import { CALL_APPLICANT } from '../modules/voice-call/server/intake';

/**
 * `pnpm voice:sim` — весь путь звонка без телефона и без микрофона.
 *
 * Поднимает сервер в процессе на `MemoryStore` (как тесты), входит гостем звонка и проигрывает
 * сценарии из `testset/calls/*.json`: `turn` → `turn` → `end`. Печатает реплики, задержку каждого
 * шага и номер заявки. С ключом Polza идёт в облако, без ключа — заглушка.
 *
 * Запасной путь для демо: если телефон или Wi-Fi подведут, разговор показывают этим скриптом.
 * Код выхода ≠ 0, если хотя бы один сценарий не создал заявку.
 */

const SCENARIO_DIR = resolve(process.cwd(), 'testset/calls');

const Scenario = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  from: z.string().default('Симулятор'),
  turns: z.array(z.string().max(2000)).min(1).max(5),
});
type Scenario = z.infer<typeof Scenario>;

interface TurnReply {
  say: string;
  done: boolean;
  emergency: boolean;
  turn: number;
}

interface EndReply {
  ticketId: string | null;
  ticketNumber: string | null;
  say: string;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

async function loadScenarios(): Promise<Scenario[]> {
  const files = (await readdir(SCENARIO_DIR)).filter((name) => name.endsWith('.json')).sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const raw = await readFile(join(SCENARIO_DIR, file), 'utf8');
    scenarios.push(Scenario.parse(JSON.parse(raw) as unknown));
  }
  return scenarios;
}

async function main(): Promise<void> {
  const scenarios = await loadScenarios();
  if (scenarios.length === 0) throw new Error(`Нет сценариев в ${SCENARIO_DIR}`);

  const store = new MemoryStore();
  // Гостя звонка в демо создаёт сид модуля; здесь кладём напрямую — сервер поднимается без базы.
  await store.saveUser(CALL_APPLICANT);
  const data = await loadReferenceData();
  const ports = createPorts(process.env);
  const ctx = await buildServer({ store, ports, data, env: process.env });

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { userId: CALL_APPLICANT.id },
  });
  if (login.statusCode !== 200) throw new Error(`Гостевой вход не удался: HTTP ${login.statusCode}`);
  const rawCookie = login.headers['set-cookie'];
  const cookie = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(';')[0] ?? '';

  console.info('');
  console.info(`Симулятор звонков · режим ИИ: ${ports.aiMode}${ports.aiMode === 'stub' ? ' (без ключа Polza — запасные фразы)' : ''}`);
  console.info(`Сценариев: ${scenarios.length} · страница звонка: /call`);
  console.info('');

  let failed = 0;
  try {
    for (const scenario of scenarios) {
      const callId = `sim-${scenario.id}-${Date.now()}`;
      const transcript: { speaker: 'caller' | 'ai'; text: string }[] = [];
      console.info(`▶ ${scenario.title} (${scenario.from})`);
      let done = false;
      for (const text of scenario.turns) {
        const started = performance.now();
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/api/m/voice-call/turn',
          headers: { cookie, 'x-forwarded-for': '127.0.0.1' },
          payload: { callId, from: scenario.from, text },
        });
        const ms = performance.now() - started;
        if (response.statusCode !== 200) {
          console.info(`  ✗ turn: HTTP ${response.statusCode} — ${response.body}`);
          failed += 1;
          break;
        }
        const reply = response.json() as TurnReply;
        console.info(`  → Вы${text === '' ? ' (тишина)' : ''}: ${text === '' ? '—' : text}`);
        console.info(`  ← ИИ (${seconds(ms)}${reply.emergency ? ', авария' : ''}): ${reply.say}`);
        transcript.push({ speaker: 'caller', text }, { speaker: 'ai', text: reply.say });
        if (reply.done) {
          done = true;
          break;
        }
      }

      const startedEnd = performance.now();
      const finished = await ctx.app.inject({
        method: 'POST',
        url: '/api/m/voice-call/end',
        headers: { cookie, 'x-forwarded-for': '127.0.0.1' },
        payload: { callId, from: scenario.from, transcript },
      });
      const endMs = performance.now() - startedEnd;
      if (finished.statusCode !== 200) {
        console.info(`  ✗ end: HTTP ${finished.statusCode} — ${finished.body}`);
        failed += 1;
        continue;
      }
      const end = finished.json() as EndReply;
      if (end.ticketId && end.ticketNumber) {
        console.info(`  ✓ Заявка ${end.ticketNumber} создана за ${seconds(endMs)}${done ? '' : ' (разговор закончил лимит реплик)'}`);
      } else {
        console.info(`  ✗ Заявка не создана: ${end.say}`);
        failed += 1;
      }
      console.info('');
    }
  } finally {
    await ctx.app.close();
  }

  if (failed > 0) {
    console.error(`Провалено сценариев: ${failed} из ${scenarios.length}. Проверьте API и ключ Polza.`);
    process.exitCode = 1;
    return;
  }
  console.info(`Все сценарии прошли: ${scenarios.length} звонков, у каждого заявка.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
