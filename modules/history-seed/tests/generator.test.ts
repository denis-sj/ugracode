import { describe, expect, it } from 'vitest';
import { cabinetLocationId, generateHistory } from '../server/generator';
import { makeHistoryInput } from './fixtures';

const input = makeHistoryInput();

describe('generateHistory', () => {
  it('детерминирован: два прогона с одним зерном совпадают', () => {
    const first = generateHistory(input);
    const second = generateHistory(input);
    expect(first).toEqual(second);
  });

  it('даёт ~600 заявок и разные данные при другом зерне', () => {
    const history = generateHistory(input);
    expect(history.tickets.length).toBe(600);

    const other = generateHistory(makeHistoryInput({ seed: 7 }));
    expect(other.tickets).not.toEqual(history.tickets);
  });

  it('включает больной принтер в кабинете 312 не меньше шести раз', () => {
    const history = generateHistory(input);
    const cabinet312 = history.tickets.filter((item) => {
      const cabinet = item.fields.find((field) => field.fieldKey === 'cabinet');
      return cabinet?.value === '312' && item.ticket.category === 'printer';
    });
    expect(cabinet312.length).toBeGreaterThanOrEqual(6);
    expect(cabinet312.every((item) => item.ticket.equipmentId === 'eq-printer-b312')).toBe(true);
  });

  it('содержит ровно три аварии', () => {
    const history = generateHistory(input);
    const emergencies = history.tickets.filter((item) => item.ticket.isEmergency);
    expect(emergencies.length).toBe(3);
    expect(emergencies.every((item) => item.ticket.priority === 'emergency')).toBe(true);
  });

  it('ссылается только на существующих инженеров, категории и технику', () => {
    const history = generateHistory(input);
    const engineerIds = new Set(input.engineers.map((engineer) => engineer.id));
    const categories = new Set(input.categories);
    const equipmentIds = new Set(input.equipment.map((item) => item.id));

    for (const item of history.tickets) {
      if (item.ticket.status === 'in_review') {
        // На проверке исполнителя ещё нет: его назначает диспетчер.
        expect(item.ticket.assigneeId).toBeNull();
      } else {
        expect(engineerIds.has(item.ticket.assigneeId ?? '')).toBe(true);
      }
      expect(categories.has(item.ticket.category ?? '')).toBe(true);
      if (item.ticket.equipmentId) {
        expect(equipmentIds.has(item.ticket.equipmentId)).toBe(true);
      }
      expect(item.ticket.locationId).toBe(
        cabinetLocationId(
          String(item.fields.find((field) => field.fieldKey === 'building')?.value ?? 'Б'),
          String(item.fields.find((field) => field.fieldKey === 'cabinet')?.value ?? '000'),
        ),
      );
    }
  });

  it('держит рабочие часы и статусы заявок', () => {
    const history = generateHistory(input);
    const openStatuses = new Set(['in_review', 'assigned']);
    for (const item of history.tickets) {
      if (openStatuses.has(item.ticket.status)) {
        // Открытые заявки — свежие, за последний час до «сейчас»: очередь на защите не просрочена.
        const age = input.now.getTime() - new Date(item.ticket.createdAt).getTime();
        expect(age).toBeGreaterThan(0);
        expect(age).toBeLessThan(60 * 60_000);
        continue;
      }
      const hour = new Date(item.ticket.createdAt).getHours();
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThanOrEqual(18);
    }

    const statuses = history.tickets.map((item) => item.ticket.status);
    const cancelled = statuses.filter((status) => status === 'cancelled').length;
    const open = statuses.filter((status) =>
      ['new', 'ai_draft', 'waiting_applicant', 'in_review', 'assigned', 'in_progress'].includes(status),
    ).length;
    expect(cancelled / history.tickets.length).toBeGreaterThan(0.1);
    expect(cancelled / history.tickets.length).toBeLessThan(0.16);
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThan(10);
  });

  it('ни одно событие истории не лежит в будущем', () => {
    const history = generateHistory(input);
    for (const item of history.tickets) {
      expect(new Date(item.event.at).getTime()).toBeLessThanOrEqual(input.now.getTime());
      expect(new Date(item.ticket.updatedAt).getTime()).toBeLessThanOrEqual(input.now.getTime());
    }
  });

  it('пишет по 2–6 полей и событие смены статуса на каждую заявку', () => {
    const history = generateHistory(input);
    for (const item of history.tickets) {
      expect(item.fields.length).toBeGreaterThanOrEqual(2);
      expect(item.fields.length).toBeLessThanOrEqual(6);
      expect(item.event.type).toBe('ticket.status.changed');
      expect(item.event.ticketId).toBe(item.ticket.id);
      expect(item.appeal.originalText.length).toBeGreaterThan(10);
    }
  });

  it('на понедельник приходится больше обращений, чем на субботу', () => {
    const history = generateHistory(input);
    const mondays = history.tickets.filter(
      (item) => new Date(item.ticket.createdAt).getDay() === 1,
    ).length;
    const saturdays = history.tickets.filter(
      (item) => new Date(item.ticket.createdAt).getDay() === 6,
    ).length;
    expect(mondays).toBeGreaterThan(saturdays);
  });
});
