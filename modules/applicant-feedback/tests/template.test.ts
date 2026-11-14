import { describe, expect, it } from 'vitest';
import type { PriorityLevel, PriorityVerdict } from '@ugra/contracts';
import { createReferenceData } from '@ugra/core';
import {
  buildConfirmation,
  buildReplyTemplate,
  formatDue,
  hasUnknownNumbers,
  priorityLabel,
  reactionMinutes,
} from '../server/template';

/** Локальное время: подписи срока зависят от часового пояса, тест не должен от него зависеть. */
const NOW = new Date(2026, 10, 14, 10, 0, 0);

function priority(level: PriorityLevel, patch: Partial<PriorityVerdict> = {}): PriorityVerdict {
  return {
    value: level,
    reactDueAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    slaDueAt: new Date(NOW.getTime() + 8 * 60 * 60_000).toISOString(),
    rule: 'матрица',
    reasons: [],
    ...patch,
  };
}

const data = createReferenceData({
  dictionaries: [
    { dictionary: 'priority', code: 'low', label: 'Низкий' },
    { dictionary: 'priority', code: 'medium', label: 'Средний' },
    { dictionary: 'priority', code: 'high', label: 'Высокий' },
    { dictionary: 'priority', code: 'critical', label: 'Критический' },
  ],
});

describe('applicant-feedback: шаблон ответа', () => {
  it.each([
    ['low', 'Низкий'],
    ['medium', 'Средний'],
    ['high', 'Высокий'],
    ['critical', 'Критический'],
  ] as const)('приоритет %s — подпись «%s», номер и срок на месте', (level, label) => {
    const text = buildReplyTemplate({
      number: '12',
      priority: priority(level),
      priorityLabel: priorityLabel(data, level),
      now: NOW,
    });

    expect(text).toContain('Заявка № 12 принята');
    expect(text).toContain(`приоритет «${label}»`);
    expect(text).toContain('срок решения — сегодня до 18:00');
    expect(text).toContain('Свяжемся с вами в течение 15 мин.');
  });

  it('без номера и приоритета ничего не выдумывает', () => {
    const text = buildReplyTemplate({
      number: null,
      priority: null,
      priorityLabel: null,
      now: NOW,
    });

    expect(text).toBe('Заявка принята. Диспетчер проверит заявку и назначит исполнителя.');
    expect(text).not.toMatch(/\d/);
  });

  it('нет срока — нет и фразы про срок', () => {
    const text = buildReplyTemplate({
      number: '12',
      priority: priority('medium', { slaDueAt: '', reactDueAt: null }),
      priorityLabel: 'Средний',
      now: NOW,
    });

    expect(text).toContain('приоритет «Средний»');
    expect(text).not.toContain('срок решения');
  });

  it('неизвестный код приоритета остаётся кодом, подпись не подменяется', () => {
    expect(priorityLabel(data, 'emergency')).toBe('Авария');
    expect(priorityLabel(createReferenceData(), 'high')).toBe('Высокий');
    expect(priorityLabel(createReferenceData(), null)).toBeNull();
  });

  it('срок понятным языком: сегодня, завтра, другая дата', () => {
    expect(formatDue(new Date(NOW.getTime() + 60 * 60_000).toISOString(), NOW)).toBe('сегодня до 11:00');
    expect(formatDue(new Date(NOW.getTime() + 26 * 60 * 60_000).toISOString(), NOW)).toBe('завтра до 12:00');
    expect(formatDue(new Date(2026, 10, 20, 9, 30).toISOString(), NOW)).toBe('20.11 до 09:30');
    expect(formatDue(null, NOW)).toBeNull();
    expect(formatDue('не дата', NOW)).toBeNull();
  });

  it('срок реакции в минутах не показывается, если он уже прошёл', () => {
    expect(reactionMinutes(new Date(NOW.getTime() + 10 * 60_000).toISOString(), NOW)).toBe(10);
    expect(reactionMinutes(new Date(NOW.getTime() - 10 * 60_000).toISOString(), NOW)).toBeNull();
    expect(reactionMinutes(null, NOW)).toBeNull();
  });

  it('сообщение после подтверждения: номер, исполнитель, срок', () => {
    const text = buildConfirmation({
      number: '12',
      assigneeName: 'Иван Петров',
      priorityLabel: 'Высокий',
      slaDueAt: new Date(NOW.getTime() + 8 * 60 * 60_000).toISOString(),
      now: NOW,
    });

    expect(text).toContain('Заявка № 12 принята');
    expect(text).toContain('Исполнитель — Иван Петров.');
    expect(text).toContain('срок решения — сегодня до 18:00');
  });

  it('нет исполнителя — сообщение не придумывает фамилию', () => {
    const text = buildConfirmation({
      number: '12',
      assigneeName: null,
      priorityLabel: null,
      slaDueAt: null,
      now: NOW,
    });

    expect(text).toContain('Заявка № 12 принята. Заявка передана в работу.');
  });

  it('числа модели обязаны быть в шаблоне', () => {
    const template = 'Заявка № 12 принята, срок решения — сегодня до 18:00.';
    expect(hasUnknownNumbers('Заявка № 12 принята, ждите до 18:00.', template)).toBe(false);
    expect(hasUnknownNumbers('Заявка № 12 принята, инженер придёт через 5 минут.', template)).toBe(true);
  });
});
