// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { UserNotification } from '@ugra/contracts';
import { NotificationsButton } from '../src/shell/NotificationsButton';
import { notificationPath } from '../src/shell/lib';

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('назначение обновляет колокольчик без открытия меню и ведёт к задаче инженера', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let notifications: UserNotification[] = [];
  const get = vi.fn().mockImplementation(async () => ({ notifications }));
  const post = vi.fn().mockResolvedValue({});
  const navigate = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(NotificationsButton, {
    api: { get, post, patch: vi.fn() },
    user: { id: 'u-engineer-1', fullName: 'Игорь Лебедев', role: 'engineer', departmentId: null, position: '' },
    navigate,
  })));
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Уведомления');
  notifications = [{ id: 'n-1', toUserId: 'u-engineer-1', channel: 'inapp', title: 'Назначена заявка', body: 'Заявка № 600', ticketId: 't-600', readAt: null, createdAt: new Date().toISOString() }];
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Уведомления, 1 новых');
  await act(async () => host.querySelector('button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('.shell-notification')!.click());
  expect(navigate).toHaveBeenCalledWith('/tasks?ticket=t-600');
  expect(post).toHaveBeenCalledWith('/api/notifications/n-1/read');
});

it('уведомления открываются в доступном кабинете каждой роли', () => {
  expect(notificationPath('engineer', null)).toBe('/tasks');
  expect(notificationPath('engineer', 'ticket/a')).toBe('/tasks?ticket=ticket%2Fa');
  expect(notificationPath('applicant', 't-1')).toBe('/tickets');
  expect(notificationPath('dispatcher', 't-1')).toBe('/review?id=t-1');
  expect(notificationPath('admin', null)).toBe('/queue');
  expect(notificationPath('manager', null)).toBe('/queue');
});
