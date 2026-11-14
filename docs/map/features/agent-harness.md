# Карта фичи: агентный харнесс (031)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-core.md](../../specs/case9-core.md), [../../tasks/031-agent-harness.md](../../tasks/031-agent-harness.md)

Цикл вызова инструментов вместо RAG: модель просит инструмент, код проверяет право и аргументы,
результат возвращается модели, итог принимается только через `submit`. Каждый шаг пишется в след
и уходит в интерфейс событием `agent.step`.

## Что добавилось

| Где | Что |
|---|---|
| `packages/contracts/src/ai.ts` | `ToolCall`, `LlmMessage`, `LlmToolSpec`, `LlmChatRequest`, `LlmChatResponse` — формат OpenAI Chat Completions |
| `packages/contracts/src/events.ts` | событие `agent.step` |
| `packages/core/src/agent.ts` | `ToolDef`, `AgentProfile`, `AgentContext`, `AgentInput`, `AgentDeps`, `AgentStep`, `AgentStepRecord`, `AgentRun`, `assembleSystemPrompt()`, `runAgent()` |
| `packages/core/src/tools.ts` | инструменты ядра `dictionary_lookup`, `cmdb_find_equipment`, `cmdb_list_locations` (`coreTools()`) |
| `packages/core/src/ports.ts` | `LlmPort.chat()` (рядом с прежним `structured()`) |
| `packages/core/src/module.ts` | у `defineModule` поля `tools` и `agents` |
| `packages/core/src/registry.ts` | `Registries.tools` (инструменты ядра + модулей), `Registries.agents`; ошибка запуска на дубликате имени и на ссылке агента на несуществующий инструмент |
| `packages/core/src/storage.ts` | `saveAgentStep()`, `listAgentSteps()` в `KernelStore` и `MemoryStore` |
| `packages/adapters/src/llm/stub.ts` | `StubLlm.chat()` — сценарная заглушка (`ScenarioTurn`), старый режим `structured` сохранён |
| `packages/adapters/src/llm/polza.ts` | `PolzaLlm.chat()`: `tools`, `temperature: 0`, `seed`, без кэша и повторов; ошибка провайдера пробрасывается |
| `packages/db` | таблица `agent_step`, миграция `0003_agent_step.sql`, `PgStore.saveAgentStep()` / `listAgentSteps()`, `mapAgentStepRow()` |
| `packages/testkit/src/module-contract.ts` | контракт инструментов и агентов: описание, zod-схема, право, существование инструментов |
| `modules/_example` | инструмент `example_echo`, агент `example`, промпт `prompts/example.v1.md` |

## Как пользоваться

1. Модуль объявляет инструмент и профиль агента:

```ts
export default defineModule({
  id: 'my-module',
  // …
  tools: [myTool],
  agents: [myAgent],
});
```

2. Запуск агента — там, где раньше был один вызов модели:

```ts
const registries = buildRegistries(modules, data.fields);
const run = await runAgent(agent, { text: appeal.originalText, context: { user, appeal, ports, data, db, clock } }, {
  llm: ports.llm,
  tools: registries.tools,
  bus,
  store,
  runId,
  onStep: (step) => hub.publish(step),
});
```

3. Результат: `run.status` (`ok`/`failed`), `run.result` (проверенный схемой), `run.steps` (след),
   `run.usage` (токены, ₽, миллисекунды).

Правила цикла:

- до `maxSteps ?? 8` обращений к модели; параллельные вызовы инструментов одного хода — один шаг;
- шлюз: инструмент есть в профиле **и** право `capability` есть у роли пользователя, иначе шаг
  `blocked: true` и модели уходит `{ "error": "недоступно" }`;
- аргументы проверяются `tool.input`, ошибка возвращается модели как результат;
- `submit` проверяется `profile.submit` и `profile.check`; ошибки возвращаются модели, цикл продолжается;
- текст обращения — данные: инструкции внутри него не исполняются (правило в системном промпте).

Сценарная заглушка для тестов и CI:

```ts
new StubLlm({}, {
  scenario: [
    { toolCalls: [{ name: 'example_echo', arguments: { text: 'привет' } }] },
    { submit: { answer: 'готово' } },
  ],
});
```

## Проверки

- `packages/core/tests/agent.test.ts` — успешный сценарий, запрещённый инструмент, несуществующий
  инструмент, неверные аргументы, падение инструмента, ошибка схемы `submit`, ошибки `check()`,
  исчерпание шагов, недоступная модель, текст вместо `submit`, событие `agent.step`,
  `assembleSystemPrompt`, реестры (дубликат инструмента, ссылка на несуществующий, дубликат агента).
- `packages/adapters/tests/llm-stub.test.ts` — ходы сценария, текстовый ход, «сценарий исчерпан»,
  сохранение старого `fallback`.
- `modules/_example/tests/contract.test.ts` — тест-контракт с инструментом и агентом.

## Особенности

- `Registries.tools` уже содержит инструменты ядра: агенту модуля достаточно сослаться на
  `dictionary_lookup` или `cmdb_*`, дублировать их не нужно.
- `StubLlm` второй аргумент конструктора понимает двояко: старый `fallback` или `{ fallback, scenario }`.
- `LlmPort.chat` обязателен — тестовые двойники портов должны добавить метод (иначе ошибка типов).
