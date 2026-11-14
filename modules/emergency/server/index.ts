import { randomUUID } from 'node:crypto';
import type { AnalysisDraft, EmergencyVerdict, Metric, UserNotification } from '@ugra/contracts';
import type { PipelineStep, StepContext } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  readEmergencyEngineers,
  readEmergencyRules,
  type EmergencyRulesFile,
} from '../contracts';
import { detectEmergency } from './detect';
import { evaluateEmergency } from './evaluate';

const STEP_ID = 'emergency.detect';

/** Текст обращения — склейка источников черновика (входной текст и ответы заявителя). */
function sourcesText(sources: readonly { text: string }[]): string {
  return sources.map((source) => source.text).join('\n');
}

function progressMessage(level: EmergencyVerdict['level']): string {
  if (level === 'confirmed') return 'Авария: подтверждена';
  if (level === 'suspected') return 'Авария: под вопросом';
  return 'Авария: не выявлена';
}

function ruleTitles(rules: EmergencyRulesFile, ids: readonly string[]): string[] {
  return rules.rules.filter((rule) => ids.includes(rule.id)).map((rule) => rule.title);
}

function notificationBody(
  appealId: string,
  verdict: EmergencyVerdict,
  rules: EmergencyRulesFile,
): string {
  const label = verdict.level === 'confirmed' ? 'Авария подтверждена' : 'Авария под вопросом';
  const quotes = verdict.signs.slice(0, 3).map((sign) => `«${sign.quote}»`);
  const titles = ruleTitles(rules, verdict.rulesMatched);
  const parts = [`${label}: обращение ${appealId}.`];
  if (quotes.length > 0) parts.push(`Признаки: ${quotes.join(', ')}.`);
  if (titles.length > 0) parts.push(`Правила: ${titles.join('; ')}.`);
  parts.push('Откройте заявку и сверьтесь с чек-листом.');
  return parts.join(' ');
}

/** Событие модуля: журнал и красный режим в интерфейсе. Без `ticketId` — в шаге его ещё нет. */
async function publishDetected(ctx: StepContext, verdict: EmergencyVerdict): Promise<void> {
  try {
    await ctx.bus?.publish({
      type: 'emergency.detected',
      actor: { kind: 'ai' },
      payload: { level: verdict.level, signs: verdict.signs, rules: verdict.rulesMatched },
    });
  } catch {
    // журнал и подписчики не должны валить разбор обращения
  }
}

/**
 * Уведомление дежурным: в хранилище (колокольчик) и через порт. Ошибка любого канала
 * не валит шаг — заявка важнее доставки.
 */
async function notifyDuty(
  ctx: StepContext,
  verdict: EmergencyVerdict,
  rules: EmergencyRulesFile,
): Promise<void> {
  if (verdict.notifyUserIds.length === 0) return;

  const title = 'Авария по обращению';
  const body = notificationBody(ctx.appeal.id, verdict, rules);
  const createdAt = ctx.ports.clock.now().toISOString();

  for (const toUserId of verdict.notifyUserIds) {
    const notification: UserNotification = {
      id: randomUUID(),
      toUserId,
      channel: 'inapp',
      title,
      body,
      ticketId: null,
      readAt: null,
      createdAt,
    };
    try {
      await ctx.db?.saveNotification(notification);
    } catch {
      // хранилище недоступно — уведомление всё равно пробуем отправить портом
    }
    try {
      await ctx.ports.notifications.send({ toUserId, channel: 'inapp', title, body });
    } catch {
      // канал — заглушка; ошибка доставки не должна ломать разбор
    }
  }
}

/**
 * Шаг `emergency.detect`: правила + мнение модели → вердикт, при сигнале — уведомление дежурному
 * и событие `emergency.detected`. Запасного пути нет: правила работают всегда и сами по себе
 * дают «под вопросом», а не обычную заявку.
 */
const detectStep: PipelineStep = {
  id: STEP_ID,
  title: 'Проверяем признаки аварии',
  stage: 'assess',
  order: 100,
  reads: ['sources', 'fields', 'ext'],
  writes: ['emergency'],
  async run(ctx) {
    const rules = readEmergencyRules(ctx.data.extra.emergencyRules);
    const verdict = detectEmergency({
      text: sourcesText(ctx.draft.sources),
      rules,
      engineers: readEmergencyEngineers(ctx.data.extra.engineers),
      ext: ctx.draft.ext,
    });

    ctx.progress({ stepId: STEP_ID, status: 'progress', message: progressMessage(verdict.level) });

    if (verdict.level !== 'none') {
      await publishDetected(ctx, verdict);
      await notifyDuty(ctx, verdict, rules);
    }

    return { emergency: verdict };
  },
  evaluate(expected: unknown, draft: AnalysisDraft): Metric[] {
    return evaluateEmergency(expected, draft);
  },
};

export default defineModule({
  id: 'emergency',
  title: 'Авария: правила, уведомление дежурному',
  enabledByDefault: true,
  steps: [detectStep],
  events: [
    {
      type: 'emergency.detected',
      description: 'Сработал сигнал аварии (правило, модель или оба): уровень, признаки с цитатами, правила',
    },
  ],
});
