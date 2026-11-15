import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type {
  MetaResponse,
  Ticket,
  TicketListResponse,
  TicketResponse,
  TicketStatus,
  User,
  UsersResponse,
} from '@ugra/contracts';
import {
  TICKET_STAGES,
  formatDayMonth,
  formatDue,
  formatTicketNumber,
  formatTicketStatus,
  groupHistory,
  ticketStage,
  ticketStatusTone,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { fieldValues, ticketTitle } from './format';

interface TicketItem {
  ticket: Ticket;
  detail: TicketResponse | null;
}

interface LoadState {
  loading: boolean;
  error: string | null;
  items: TicketItem[];
  users: User[];
}

type Tab = 'active' | 'closed';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function titleOf(item: TicketItem, meta: MetaResponse): string {
  if (item.detail) {
    return ticketTitle({
      fields: fieldValues(item.detail.fields, {}),
      fieldsMeta: meta.fields,
      dictionaries: meta.dictionaries,
    });
  }
  if (!item.ticket.category) return 'Обращение';
  const found = meta.dictionaries.find(
    (entry) => entry.dictionary === 'category' && entry.code === item.ticket.category,
  );
  return found?.label ?? item.ticket.category;
}

function assigneeOf(item: TicketItem, users: readonly User[]): string | null {
  const id = item.ticket.assigneeId;
  if (!id) return null;
  return users.find((user) => user.id === id)?.fullName ?? null;
}

function StageScale({ stage }: { stage: number }): JSX.Element {
  return (
    <span className="tickets-seg" aria-hidden="true">
      {TICKET_STAGES.map((label, index) => (
        <span
          key={label}
          className={index < stage ? 'tickets-seg__part tickets-seg__part--on' : 'tickets-seg__part'}
        />
      ))}
    </span>
  );
}

function StatusText({ status }: { status: TicketStatus }): JSX.Element {
  return (
    <span className={`tickets-status tickets-status--${ticketStatusTone(status)}`}>
      {formatTicketStatus(status)}
    </span>
  );
}

/** Экран «Мои заявки» (4.2): подтверждение выполнения сверху, активные и закрытые списком. */
export function TicketsPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('active');
  const [state, setState] = useState<LoadState>({ loading: true, error: null, items: [], users: [] });
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [list, users] = await Promise.all([
        api.get<TicketListResponse>('/api/tickets?limit=50'),
        api.get<UsersResponse>('/api/users'),
      ]);
      const details = await Promise.all(
        list.tickets.map((ticket) => api.get<TicketResponse>(`/api/tickets/${ticket.id}`).catch(() => null)),
      );
      const items: TicketItem[] = list.tickets.map((ticket, index) => ({
        ticket,
        detail: details[index] ?? null,
      }));
      setState({ loading: false, error: null, items, users: users.users });
    } catch (caught) {
      setState((previous) => ({ ...previous, loading: false, error: errorText(caught) }));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupHistory(state.items.map((item) => item.ticket)), [state.items]);

  const itemById = useMemo(() => new Map(state.items.map((item) => [item.ticket.id, item])), [state.items]);
  const activeItems = groups.active
    .map((ticket) => itemById.get(ticket.id))
    .filter((item): item is TicketItem => Boolean(item));
  const closedItems = groups.closed
    .map((ticket) => itemById.get(ticket.id))
    .filter((item): item is TicketItem => Boolean(item));

  const visible = tab === 'active' ? activeItems : closedItems;
  const awaiting = activeItems.find((item) => item.ticket.status === 'resolved');
  const listRef = useRef<HTMLElement | null>(null);
  useListMotion(listRef, visible.length > 0);

  const transition = async (ticket: Ticket, to: TicketStatus): Promise<void> => {
    setActing(ticket.id);
    setActionError(null);
    try {
      await api.post(`/api/tickets/${ticket.id}/transition`, { to });
      trackAction?.('system');
      await load();
    } catch (caught) {
      setActionError(`Не удалось изменить заявку: ${errorText(caught)}`);
    } finally {
      setActing(null);
    }
  };

  return (
    <main className="tickets-page">
      <div className="tickets-head" data-reveal>
        <h1 className="ugra-page-title">Мои заявки</h1>
        <div className="tickets-tabs ugra-liquid" role="tablist" aria-label="Мои заявки">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={tab === 'active' ? 'tickets-tab tickets-tab--on' : 'tickets-tab'}
            onClick={() => setTab('active')}
          >
            Активные · {activeItems.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'closed'}
            className={tab === 'closed' ? 'tickets-tab tickets-tab--on' : 'tickets-tab'}
            onClick={() => setTab('closed')}
          >
            Закрытые · {closedItems.length}
          </button>
        </div>
      </div>

      {state.error && (
        <section className="tickets-error" role="alert">
          <p>{state.error}</p>
          <button type="button" className="ugra-btn ugra-btn--secondary" onClick={() => void load()}>
            Обновить
          </button>
        </section>
      )}

      {actionError && (
        <p className="tickets-action-error" role="alert">
          {actionError}
        </p>
      )}

      {awaiting && (
        <article className="tickets-confirm">
          <div className="tickets-confirm__top">
            <span className="tickets-meta">
              {formatTicketNumber(awaiting.ticket.number)} · {formatDayMonth(awaiting.ticket.createdAt)}
            </span>
            <span className="tickets-confirm__flag">Нужно ваше подтверждение</span>
          </div>
          <h2 className="tickets-confirm__title">{titleOf(awaiting, meta)}</h2>
          <StageScale stage={ticketStage(awaiting.ticket.status)} />
          <p className="tickets-confirm__note">
            {assigneeOf(awaiting, state.users) ? (
              <>
                Инженер <strong>{assigneeOf(awaiting, state.users)}</strong>
                {awaiting.ticket.resolution?.trim()
                  ? `: «${awaiting.ticket.resolution.trim()}»`
                  : ' отметил работу выполненной.'}
              </>
            ) : (
              awaiting.ticket.resolution?.trim() || 'Работа отмечена выполненной.'
            )}
          </p>
          <div className="tickets-confirm__actions">
            <button
              type="button"
              className="ugra-btn ugra-btn--primary"
              disabled={acting !== null}
              onClick={() => void transition(awaiting.ticket, 'closed')}
            >
              Да, всё работает
            </button>
            <button
              type="button"
              className="ugra-btn ugra-btn--secondary"
              disabled={acting !== null}
              onClick={() => void transition(awaiting.ticket, 'in_progress')}
            >
              Вернуть инженеру
            </button>
          </div>
        </article>
      )}

      {state.loading && state.items.length === 0 && (
        <section className="tickets-list tickets-list--loading" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div className="tickets-skeleton" key={index}>
              <span className="tickets-skeleton__line" />
              <span className="tickets-skeleton__line tickets-skeleton__line--short" />
            </div>
          ))}
        </section>
      )}

      {!state.loading && visible.length === 0 && !state.error && (
        <section className="tickets-empty">
          <p className="tickets-empty__title">
            {tab === 'active' ? 'Активных заявок нет' : 'Закрытых заявок пока нет'}
          </p>
          <p className="tickets-empty__hint">
            {tab === 'active'
              ? 'Опишите проблему на вкладке «Обращение» — заявка появится здесь.'
              : 'Здесь появятся завершённые обращения.'}
          </p>
        </section>
      )}

      {visible.length > 0 && (
        <section className="tickets-list" ref={listRef}>
          <div className="tickets-row tickets-row--head" aria-hidden="true">
            <span className="tickets-label">Заявка</span>
            <span className="tickets-label">Ход</span>
            <span className="tickets-label">Исполнитель и срок</span>
          </div>
          {visible.map((item) => {
            const assignee = assigneeOf(item, state.users);
            return (
              <article className="tickets-row" key={item.ticket.id}>
                <span className="tickets-cell">
                  <span className="tickets-title">{titleOf(item, meta)}</span>
                  <span className="tickets-meta">{formatTicketNumber(item.ticket.number)}</span>
                </span>
                <span className="tickets-cell tickets-cell--stage">
                  {/* Статус — подпись к полоскам хода, а не к названию заявки. */}
                  <span className="tickets-stage-label">
                    <StatusText status={item.ticket.status} />
                  </span>
                  <StageScale stage={ticketStage(item.ticket.status)} />
                </span>
                <span className="tickets-cell tickets-cell--who">
                  <span className="tickets-who">{assignee ?? 'Не назначен'}</span>
                  <span className="tickets-due">{formatDue(item.ticket.slaDueAt)}</span>
                </span>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
