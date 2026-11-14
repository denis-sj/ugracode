import { describe, expect, it } from 'vitest';
import { normalizePath, parseHash, toHash } from '../src/router';
import {
  firstTab,
  formatRelativeTime,
  initials,
  isTabPath,
  matchesQuery,
  roleLabel,
  tabsForRole,
} from '../src/shell/lib';

describe('tabsForRole', () => {
  it('у заявителя две вкладки — обращение и мои заявки', () => {
    expect(tabsForRole('applicant').map((tab) => tab.path)).toEqual(['/chat', '/tickets']);
  });

  it('у диспетчера очередь, аварии, журнал и исполнители', () => {
    const tabs = tabsForRole('dispatcher');
    expect(tabs.map((tab) => tab.label)).toEqual(['Очередь', 'Аварии', 'Журнал', 'Исполнители']);
    expect(tabs.find((tab) => tab.path === '/incidents')?.danger).toBe(true);
  });

  it('у инженера задачи и база знаний, у руководителя — отчёты', () => {
    expect(tabsForRole('engineer').map((tab) => tab.path)).toEqual(['/tasks', '/knowledge']);
    expect(tabsForRole('manager').map((tab) => tab.path)).toEqual(['/dashboard', '/reports', '/quality']);
  });

  it('администратор видит очередь и дашборд', () => {
    const paths = tabsForRole('admin').map((tab) => tab.path);
    expect(paths).toContain('/queue');
    expect(paths).toContain('/dashboard');
  });

  it('первая вкладка роли — стартовая', () => {
    expect(firstTab('applicant').path).toBe('/chat');
    expect(firstTab('dispatcher').path).toBe('/queue');
  });

  it('isTabPath знает только вкладки своей роли', () => {
    expect(isTabPath('applicant', '/chat')).toBe(true);
    expect(isTabPath('applicant', '/queue')).toBe(false);
  });
});

describe('roleLabel', () => {
  it('подписывает роли', () => {
    expect(roleLabel('applicant')).toBe('Заявитель');
    expect(roleLabel('engineer')).toBe('Инженер');
    expect(roleLabel('admin')).toBe('Администратор');
  });
});

describe('initials', () => {
  it('берёт первые буквы имени и фамилии', () => {
    expect(initials('Денис Соколов')).toBe('ДС');
    expect(initials('Анна Петровна Миронова')).toBe('АМ');
  });

  it('одно слово — две первые буквы, пусто — вопросительный знак', () => {
    expect(initials('Роман')).toBe('РО');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date(2026, 10, 14, 12, 0);

  it('подписывает минуты, вчера и дату', () => {
    expect(formatRelativeTime(new Date(2026, 10, 14, 11, 50).toISOString(), now)).toBe('10 мин назад');
    expect(formatRelativeTime(new Date(2026, 10, 14, 11, 59, 40).toISOString(), now)).toBe('только что');
    expect(formatRelativeTime(new Date(2026, 10, 13, 16, 20).toISOString(), now)).toBe('вчера, 16:20');
    expect(formatRelativeTime(new Date(2026, 10, 8, 9, 0).toISOString(), now)).toBe('8 нояб.');
  });

  it('не падает на неверной дате', () => {
    expect(formatRelativeTime('мусор', now)).toBe('—');
  });
});

describe('matchesQuery', () => {
  it('пустой запрос подходит ко всему', () => {
    expect(matchesQuery('', 'что угодно')).toBe(true);
  });

  it('ищет без учёта регистра по любому из полей', () => {
    expect(matchesQuery('ПРИНТЕР', 'Обращение', 'Не печатает принтер')).toBe(true);
    expect(matchesQuery('0398', null, '№ 2026-0398')).toBe(true);
    expect(matchesQuery('vpn', 'Обращение')).toBe(false);
  });
});

describe('router', () => {
  it('разбирает hash с query', () => {
    const route = parseHash('#/tickets?tab=closed');
    expect(route.path).toBe('/tickets');
    expect(route.query.get('tab')).toBe('closed');
  });

  it('нормализует пустой и относительный путь', () => {
    expect(parseHash('').path).toBe('/');
    expect(normalizePath('chat/')).toBe('/chat');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('//queue//')).toBe('//queue');
  });

  it('собирает hash обратно', () => {
    expect(toHash('tickets')).toBe('#/tickets');
    expect(toHash('/chat/')).toBe('#/chat');
  });

  it('сохраняет query очереди и проверки в hash', () => {
    expect(toHash('/queue?status=in_review')).toBe('#/queue?status=in_review');
    const queue = parseHash('#/queue?status=in_review&emergency=true&assignee=u-1');
    expect(queue.path).toBe('/queue');
    expect(queue.query.get('status')).toBe('in_review');
    expect(queue.query.get('emergency')).toBe('true');
    expect(queue.query.get('assignee')).toBe('u-1');

    const review = parseHash('#/review?id=t-42');
    expect(review.path).toBe('/review');
    expect(review.query.get('id')).toBe('t-42');
  });
});
