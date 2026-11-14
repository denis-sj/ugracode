import type {
  DeliveryResult,
  Notification,
  NotificationPort,
} from '@ugra/core';

/** In-memory уведомления: складывает отправленное в массив. */
export class InMemoryNotifications implements NotificationPort {
  private readonly sent: Notification[] = [];

  async send(notification: Notification): Promise<DeliveryResult> {
    this.sent.push(notification);
    return { delivered: true, id: `ntf-${this.sent.length}` };
  }

  list(): Notification[] {
    return [...this.sent];
  }

  clear(): void {
    this.sent.length = 0;
  }
}
