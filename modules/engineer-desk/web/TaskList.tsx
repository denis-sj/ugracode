import type { Ticket } from '@ugra/contracts';
import type { JSX } from 'react';
import { useRef } from 'react';
import { Card, EmptyState, PriorityMark, useListMotion } from '@ugra/ui';
import {
  capitalizeFirst,
  dueState,
  nearestDueAt,
  shortDueLabel,
  taskTitle,
  tasksCountLabel,
} from './format';
import type { TaskPreview } from './types';

interface TaskListProps {
  tasks: readonly Ticket[];
  previews: Readonly<Record<string, TaskPreview>>;
  selectedId: string | null;
  now: number;
  loading: boolean;
  onSelect: (ticketId: string) => void;
}

/** Список задач на сегодня: приоритет шаром, место, срок. Выбор — одна строка. */
export function TaskList({
  tasks,
  previews,
  selectedId,
  now,
  loading,
  onSelect,
}: TaskListProps): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  useListMotion(listRef, tasks.length > 0);

  return (
    <Card padded={false} className="ed-list">
      <p className="ed-list__head">Сегодня · {tasksCountLabel(tasks.length)}</p>

      {loading && tasks.length === 0 && (
        <div className="ed-skeleton" aria-label="Загружаем задачи">
          <span className="ed-skeleton__line" />
          <span className="ed-skeleton__line ed-skeleton__line--short" />
          <span className="ed-skeleton__line" />
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="ed-list__empty">
          <EmptyState
            title="Задач на сегодня нет"
            hint="Как только диспетчер назначит заявку, она появится здесь."
          />
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="ed-list__items" aria-label="Задачи на сегодня" ref={listRef}>
          {tasks.map((ticket) => {
            const preview = previews[ticket.id];
            const dueAt = nearestDueAt(ticket);
            const due = dueState(dueAt, now);
            const selected = ticket.id === selectedId;
            return (
              <li key={ticket.id}>
                <button
                  type="button"
                  className={selected ? 'ed-task-row ed-task-row--on' : 'ed-task-row'}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(ticket.id)}
                >
                  <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} className="ed-task-row__mark" />
                  <span className="ed-task-row__body">
                    <span className="ed-task-row__title">
                      {capitalizeFirst(preview?.title ?? taskTitle(null, ticket, []))}
                    </span>
                    <span className="ed-task-row__place">{preview?.place || 'место не указано'}</span>
                  </span>
                  <span className={due ? `ed-task-row__due ed-due--${due.tone}` : 'ed-task-row__due'}>
                    {shortDueLabel(dueAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
