import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { OverdueResult } from '../contracts';
import type { OverviewQuery } from './api';
import { fetchOverdue } from './api';
import { formatTicketNumber } from '@ugra/ui';
import { formatCount, formatMinutes } from './format';

export interface OverdueDrawerProps {
  open: boolean;
  onClose: () => void;
  query: OverviewQuery;
  /** Строка вывода ИИ про SLA из уже загруженного отчёта — без нового вызова модели. */
  reason: string | null;
  /** Всего нарушений срока за период (как на плитке) — чтобы числа не расходились. */
  slaBreaches: number;
}

/**
 * Правая шторка дашборда «N просрочено →» (макет D2, раздел 4 плана).
 * Не уводит на очередь: руководитель остаётся на дашборде и видит причину и группы.
 */
export function OverdueDrawer({
  open,
  onClose,
  query,
  reason,
  slaBreaches,
}: OverdueDrawerProps): JSX.Element | null {
  const [data, setData] = useState<OverdueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setCopied(false);
    fetchOverdue(query, controller.signal)
      .then((result) => setData(result))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const copy = useCallback(async (): Promise<void> => {
    if (!data) return;
    const text = data.items
      .map(
        (item) =>
          `${formatTicketNumber(item.number)} · ${item.title} · ${item.assigneeName ?? 'без исполнителя'} · ${formatMinutes(item.overdueMinutes)}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Браузер не разрешил копирование — выделите список вручную');
    }
  }, [data]);

  if (!open) return null;

  return (
    <div className="rd-drawer-root">
      <button type="button" className="rd-drawer__backdrop" aria-label="Закрыть" onClick={onClose} />
      <aside className="rd-drawer" role="dialog" aria-modal="true" aria-label="Просроченные заявки">
        <header className="rd-drawer__head">
          <div>
            <span className="rd-cap">Просрочено сейчас</span>
            <h2 className="rd-drawer__title">{data ? formatCount(data.total) : '…'}</h2>
            <span className="rd-drawer__hint">Всего нарушений срока за период: {formatCount(slaBreaches)}</span>
          </div>
          <button type="button" className="rd-drawer__close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>

        {reason && <p className="rd-drawer__reason">{reason}</p>}

        {loading && <p className="rd-drawer__hint">Загружаем список…</p>}
        {error && <p className="rd-drawer__hint rd-drawer__hint--error">{error}</p>}

        {data && data.total === 0 && !loading && (
          <p className="rd-drawer__hint">За период просрочек нет — все сроки соблюдены.</p>
        )}

        {data && data.groups.length > 0 && (
          <ul className="rd-groups">
            {data.groups.map((group) => (
              <li key={group.assigneeId ?? 'none'}>
                <span>{group.assigneeName}</span>
                <b>{formatCount(group.count)}</b>
              </li>
            ))}
          </ul>
        )}

        {data && data.items.length > 0 && (
          <>
            <ol className="rd-overdue">
              {data.items.slice(0, 30).map((item) => (
                <li key={item.ticketId}>
                  <span className="rd-overdue__title">{item.title}</span>
                  <span className="rd-overdue__meta">
                    {formatTicketNumber(item.number)} · {item.assigneeName ?? 'без исполнителя'}
                  </span>
                  <span className="rd-overdue__late">+{formatMinutes(item.overdueMinutes)}</span>
                </li>
              ))}
            </ol>
            <div className="rd-drawer__actions">
              <button type="button" className="ugra-btn ugra-btn--secondary ugra-btn--sm" onClick={() => void copy()}>
                {copied ? 'Скопировано' : 'Скопировать список'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
