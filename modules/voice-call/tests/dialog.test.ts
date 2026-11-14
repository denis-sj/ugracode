import { describe, expect, it } from 'vitest';
import type { LlmChatResponse } from '@ugra/contracts';
import type { LlmPort } from '@ugra/core';
import type { CallLine } from '../server/calls';
import {
  EMERGENCY_SAY,
  FALLBACK_QUESTION,
  LIMIT_FAREWELL,
  MAX_SAY_CHARS,
  SILENCE_QUESTION,
  dialogMessages,
  dialogTurn,
  hasEmergencySign,
  parseReply,
  speakable,
} from '../server/dialog';

const at = '2026-11-14T10:00:00.000Z';

function caller(text: string): CallLine {
  return { speaker: 'caller', text, at };
}

function ai(text: string): CallLine {
  return { speaker: 'ai', text, at };
}

function llmReturning(content: string | null, delayMs = 0): LlmPort & { calls: number } {
  const port = {
    calls: 0,
    structured: async () => Promise.reject(new Error('не нужен')),
    async chat(): Promise<LlmChatResponse> {
      port.calls += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { message: { role: 'assistant', content, toolCalls: [] }, finishReason: 'stop', model: 'stub' };
    },
  };
  return port;
}

describe('диалоговый шаг', () => {
  it('отдаёт фразу модели и уточняет кабинет', async () => {
    const llm = llmReturning('{"say":"Подскажите номер кабинета.","done":false,"emergency":false}');
    const decision = await dialogTurn({ llm, lines: [caller('не печатает принтер')], elapsedMs: 1000 });
    expect(decision).toMatchObject({ say: 'Подскажите номер кабинета.', done: false, emergency: false, source: 'ai' });
    expect(llm.calls).toBe(1);
  });

  it('модель упала → запасной вопрос, звонок продолжается', async () => {
    const llm = { ...llmReturning(null), chat: async () => Promise.reject(new Error('HTTP 500')) };
    const decision = await dialogTurn({ llm, lines: [caller('не печатает принтер')], elapsedMs: 0 });
    expect(decision).toMatchObject({ say: FALLBACK_QUESTION, done: false, source: 'fallback' });
  });

  it('модель не уложилась в таймаут → запасной вопрос', async () => {
    const llm = llmReturning('{"say":"поздно","done":false,"emergency":false}', 200);
    const decision = await dialogTurn({ llm, lines: [caller('не печатает принтер')], elapsedMs: 0, timeoutMs: 20 });
    expect(decision.say).toBe(FALLBACK_QUESTION);
    expect(decision.source).toBe('fallback');
  });

  it('модель вернула не JSON → запасной вопрос', async () => {
    const decision = await dialogTurn({ llm: llmReturning('Здравствуйте!'), lines: [caller('принтер')], elapsedMs: 0 });
    expect(decision.source).toBe('fallback');
  });

  it('дым по словам заявителя → авария без вызова модели', async () => {
    const llm = llmReturning('{"say":"x","done":false,"emergency":false}');
    const decision = await dialogTurn({ llm, lines: [caller('в серверной идёт дым')], elapsedMs: 0 });
    expect(decision).toMatchObject({ say: EMERGENCY_SAY, done: true, emergency: true, source: 'rule' });
    expect(llm.calls).toBe(0);
  });

  it('модель увидела аварию → передаём дежурному', async () => {
    const llm = llmReturning('{"say":"Передаю","done":false,"emergency":true}');
    const decision = await dialogTurn({ llm, lines: [caller('сеть пропала у всех на третьем')], elapsedMs: 0 });
    expect(decision).toMatchObject({ say: EMERGENCY_SAY, done: true, emergency: true, source: 'ai' });
  });

  it('третья реплика заявителя → прощаемся без модели', async () => {
    const llm = llmReturning('{"say":"ещё вопрос","done":false,"emergency":false}');
    const lines = [caller('принтер'), ai('Где?'), caller('корпус Б'), ai('Кабинет?'), caller('312')];
    const decision = await dialogTurn({ llm, lines, elapsedMs: 30_000 });
    expect(decision).toMatchObject({ say: LIMIT_FAREWELL, done: true, source: 'rule' });
    expect(llm.calls).toBe(0);
  });

  it('звонок дольше 90 секунд → прощаемся', async () => {
    const decision = await dialogTurn({ llm: llmReturning(null), lines: [caller('принтер')], elapsedMs: 95_000 });
    expect(decision.done).toBe(true);
    expect(decision.say).toBe(LIMIT_FAREWELL);
  });

  it('тишина → просим повторить', async () => {
    const llm = llmReturning(null);
    const decision = await dialogTurn({ llm, lines: [caller('  ')], elapsedMs: 0 });
    expect(decision).toMatchObject({ say: SILENCE_QUESTION, done: false });
    expect(llm.calls).toBe(0);
  });

  it('тишина на последней реплике → прощаемся', async () => {
    const lines = [caller('принтер'), ai('Где?'), caller('Б'), ai('Кабинет?'), caller('')];
    const decision = await dialogTurn({ llm: llmReturning(null), lines, elapsedMs: 0 });
    expect(decision.done).toBe(true);
  });
});

describe('разбор ответа модели', () => {
  it('принимает JSON в обёртке ```json', () => {
    expect(parseReply('```json\n{"say":"Кабинет?","done":false,"emergency":false}\n```')?.say).toBe('Кабинет?');
  });

  it('отвергает пустую фразу и неполный объект', () => {
    expect(parseReply('{"say":"  ","done":false,"emergency":false}')).toBeNull();
    expect(parseReply('{"say":"x"}')).toBeNull();
    expect(parseReply(null)).toBeNull();
    expect(parseReply('{oops}')).toBeNull();
  });

  it('убирает markdown и укорачивает длинную фразу', () => {
    expect(speakable('**Кабинет?**\n«312»')).toBe('Кабинет? 312');
    const long = `${'Очень длинное объяснение. '.repeat(20)}`;
    expect(speakable(long).length).toBeLessThanOrEqual(MAX_SAY_CHARS);
  });
});

describe('признаки аварии', () => {
  it.each(['идёт дым из розетки', 'искрит щиток', 'пахнет гарью', 'нет сети на весь этаж'])('«%s» — авария', (text) => {
    expect(hasEmergencySign(text)).toBe(true);
  });

  it.each(['не печатает принтер', 'забыл пароль от почты', 'дымчатый корпус монитора треснул'])('«%s» — не авария', (text) => {
    expect(hasEmergencySign(text)).toBe(false);
  });
});

describe('сообщения модели', () => {
  it('реплики ИИ идут ассистентом в JSON, промпт и счётчик реплик — системой', () => {
    const messages = dialogMessages([caller('принтер'), ai('Где?'), caller('312')]);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('голосовой оператор');
    expect(messages[1]?.content).toContain('Реплика заявителя 2 из 3');
    expect(messages[3]).toEqual({ role: 'assistant', content: '{"say":"Где?","done":false,"emergency":false}' });
  });
});
