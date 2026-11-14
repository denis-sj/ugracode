import { describe, expect, it } from 'vitest';
import type { Ticket } from '@ugra/contracts';
import {
  formatDayMonth,
  formatDayTime,
  formatDue,
  formatTicketStatus,
  groupHistory,
  isActiveStatus,
  stageSegments,
  ticketStage,
  ticketStatusTone,
} from '../src/ticket-format';

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 't-1',
    number: 'З-20261114-0001',
    appealId: 'a-1',
    status: 'new',
    priority: null,
    category: null,
    departmentId: null,
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
    ...overrides,
  };
}

describe('formatTicketStatus', () => {
  it('переводит статусы на русский', () => {
    expect(formatTicketStatus('assigned')).toBe('Назначена');
    expect(formatTicketStatus('in_progress')).toBe('В работе');
    expect(formatTicketStatus('resolved')).toBe('Подтвердите выполнение');
    expect(formatTicketStatus('closed')).toBe('Закрыта');
  });

  it('даёт тон для цветного текста', () => {
    expect(ticketStatusTone('resolved')).toBe('warn');
    expect(ticketStatusTone('closed')).toBe('ok');
    expect(ticketStatusTone('assigned')).toBe('info');
  });
});

describe('ticketStage', () => {
  it('считает сегменты «Собрана → Проверена → Назначена → Выполнена»', () => {
    expect(ticketStage('new')).toBe(1);
    expect(ticketStage('ai_draft')).toBe(1);
    expect(ticketStage('waiting_applicant')).toBe(1);
    expect(ticketStage('in_review')).toBe(2);
    expect(ticketStage('assigned')).toBe(3);
    expect(ticketStage('in_progress')).toBe(3);
    expect(ticketStage('resolved')).toBe(4);
    expect(ticketStage('closed')).toBe(4);
  });

  it('проверенная заявка закрашивает два сегмента, назначенная — три', () => {
    expect(ticketStage('in_review')).toBeGreaterThan(ticketStage('new'));
    expect(ticketStage('assigned')).toBeGreaterThan(ticketStage('in_review'));
    expect(ticketStage('resolved')).toBe(4);
  });

  it('отменённая заявка не заполняет шкалу', () => {
    expect(ticketStage('cancelled')).toBe(0);
  });
});

describe('stageSegments', () => {
  it('закрашивает ровно столько сегментов, сколько прошла заявка', () => {
    expect(stageSegments(0)).toEqual([false, false, false, false]);
    expect(stageSegments(2)).toEqual([true, true, false, false]);
    expect(stageSegments(4)).toEqual([true, true, true, true]);
  });

  it('обрезает значения вне диапазона и переживает мусор', () => {
    expect(stageSegments(-3)).toEqual([false, false, false, false]);
    expect(stageSegments(9)).toEqual([true, true, true, true]);
    expect(stageSegments(Number.NaN)).toEqual([false, false, false, false]);
    expect(stageSegments(2, Number.NaN)).toEqual([]);
    expect(stageSegments(0, 0)).toEqual([]);
  });

  it('поддерживает своё число сегментов', () => {
    expect(stageSegments(1, 3)).toEqual([true, false, false]);
    expect(stageSegments(2.9, 3)).toEqual([true, true, false]);
  });
});

describe('isActiveStatus', () => {
  it('закрытые и отменённые — не активные', () => {
    expect(isActiveStatus('assigned')).toBe(true);
    expect(isActiveStatus('resolved')).toBe(true);
    expect(isActiveStatus('closed')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
  });
});

describe('groupHistory', () => {
  it('делит историю на активные и ранее, свежие сверху', () => {
    const older = ticket({ id: 'old', status: 'closed', updatedAt: '2026-11-01T10:00:00.000Z' });
    const newer = ticket({ id: 'new', status: 'closed', updatedAt: '2026-11-10T10:00:00.000Z' });
    const active = ticket({ id: 'active', status: 'in_progress', updatedAt: '2026-11-12T10:00:00.000Z' });

    const groups = groupHistory([older, active, newer]);

    expect(groups.active.map((item) => item.id)).toEqual(['active']);
    expect(groups.closed.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('на пустом списке даёт две пустые группы', () => {
    expect(groupHistory([])).toEqual({ active: [], closed: [] });
  });
});

describe('formatDue', () => {
  const now = new Date(2026, 10, 14, 10, 0);

  it('подписывает сегодня и завтра', () => {
    expect(formatDue(new Date(2026, 10, 14, 14, 30).toISOString(), now)).toBe('сегодня до 14:30');
    expect(formatDue(new Date(2026, 10, 15, 12, 0).toISOString(), now)).toBe('завтра до 12:00');
  });

  it('для дальнего срока показывает дату', () => {
    expect(formatDue(new Date(2026, 10, 18, 9, 5).toISOString(), now)).toBe('18 нояб. до 09:05');
  });

  it('без срока — прочерк', () => {
    expect(formatDue(null)).toBe('—');
    expect(formatDue('не дата')).toBe('—');
  });
});

describe('formatDayMonth и formatDayTime', () => {
  it('форматирует дату и время', () => {
    const iso = new Date(2026, 10, 12, 9, 7).toISOString();
    expect(formatDayMonth(iso)).toBe('12 нояб.');
    expect(formatDayTime(iso)).toBe('12 нояб., 09:07');
  });

  it('пустое значение — прочерк', () => {
    expect(formatDayMonth(null)).toBe('—');
    expect(formatDayTime('')).toBe('—');
  });
});
