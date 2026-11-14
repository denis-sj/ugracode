import { describe, expect, it } from 'vitest';
import { InMemoryNotifications } from '@ugra/adapters';
import type { Notification } from '@ugra/core';

const notification: Notification = {
  toUserId: 'u-1',
  channel: 'inapp',
  title: 'Заявка принята',
  body: 'Принтер в кабинете 312',
  ticketId: 't-1',
};

describe('InMemoryNotifications', () => {
  it('складывает уведомления и подтверждает доставку', async () => {
    const notifications = new InMemoryNotifications();

    const first = await notifications.send(notification);
    const second = await notifications.send({ ...notification, toUserId: 'u-2' });

    expect(first).toEqual({ delivered: true, id: 'ntf-1' });
    expect(second).toEqual({ delivered: true, id: 'ntf-2' });
    expect(notifications.list()).toHaveLength(2);
    expect(notifications.list()[1]?.toUserId).toBe('u-2');
  });

  it('очищается', async () => {
    const notifications = new InMemoryNotifications();
    await notifications.send(notification);
    notifications.clear();

    expect(notifications.list()).toEqual([]);
  });
});
