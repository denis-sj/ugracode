import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { NotificationsResponse, User, UserNotification } from '@ugra/contracts';
import { cx, Icon, useBackgroundRefresh, useListMotion } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { formatRelativeTime, notificationPath } from './lib';

export interface NotificationsButtonProps {
  api: ApiClient;
  user: User;
  navigate: (path: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Колокольчик с выпадающим блоком (3.2), а не отдельной страницей. */
export function NotificationsButton({ api, user, navigate }: NotificationsButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useListMotion(listRef, open && items.length > 0);

  const load = useCallback(async (quiet = false): Promise<void> => {
    if (!quiet) { setLoading(true); setError(null); }
    try {
      const response = await api.get<NotificationsResponse>('/api/notifications');
      setItems(response.notifications);
    } catch (caught) {
      if (!quiet) setError(errorText(caught));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, user.id]);

  useEffect(() => {
    void load();
  }, [load]);
  const refreshNotifications = useCallback(() => load(true), [load]);
  useBackgroundRefresh(refreshNotifications);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const unread = items.filter((item) => item.readAt === null).length;

  const markRead = async (notification: UserNotification): Promise<void> => {
    if (notification.readAt !== null) return;
    try {
      await api.post(`/api/notifications/${notification.id}/read`);
      const now = new Date().toISOString();
      setItems((previous) =>
        previous.map((item) => (item.id === notification.id ? { ...item, readAt: now } : item)),
      );
    } catch {
      // Непрочитанное останется подсвеченным — это безопаснее, чем скрыть его без записи.
    }
  };

  const readAll = async (): Promise<void> => {
    const unreadItems = items.filter((item) => item.readAt === null);
    if (unreadItems.length === 0) return;
    const now = new Date().toISOString();
    setItems((previous) => previous.map((item) => (item.readAt === null ? { ...item, readAt: now } : item)));
    await Promise.all(
      unreadItems.map((item) => api.post(`/api/notifications/${item.id}/read`).catch(() => undefined)),
    );
  };

  const openNotification = (notification: UserNotification): void => {
    void markRead(notification);
    setOpen(false);
    navigate(notificationPath(user.role, notification.ticketId));
  };

  return (
    <div className="shell-pop-root" ref={rootRef}>
      <button
        type="button"
        className={cx('shell-icon', 'ugra-liquid', open && 'shell-icon--active')}
        aria-label={unread > 0 ? `Уведомления, ${unread} новых` : 'Уведомления'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((previous) => !previous);
          if (!open) void load();
        }}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="shell-icon__badge" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="shell-notifications" role="dialog" aria-label="Уведомления">
          <div className="shell-notifications__head">
            <b>Уведомления</b>
            <button
              type="button"
              className="shell-notifications__read-all"
              onClick={() => void readAll()}
              disabled={unread === 0}
            >
              Прочитать все
            </button>
          </div>

          {loading && items.length === 0 && <p className="shell-notifications__hint">Загружаем…</p>}
          {error && <p className="shell-notifications__hint shell-notifications__hint--error">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="shell-notifications__hint">Уведомлений нет</p>
          )}

          <div className="shell-notifications__list" ref={listRef}>
            {items.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={cx(
                  'shell-notification',
                  notification.readAt === null && 'shell-notification--unread',
                )}
                onClick={() => openNotification(notification)}
              >
                <span className="shell-notification__body">{(notification.body || notification.title).replace(/: обращение [0-9a-f]{8}-[0-9a-f-]{27,}\./gi, '.')}</span>
                <span className="shell-notification__time">{formatRelativeTime(notification.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
