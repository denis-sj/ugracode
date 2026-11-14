import type { Ticket } from '@ugra/contracts';
import type { JSX, ReactNode } from 'react';
import { Button, Card, PersonAvatar, PriorityMark, Timer, cx } from '@ugra/ui';
import { CONFIDENCE_THRESHOLD } from './format';

/**
 * Части экрана «Очередь» (вариант A макета): закреплённая полоса аварии, группа строк
 * и строка заявки. Всё оформление — классы `queue-*` из `review.css`.
 */

export interface QueueAlarmProps {
  ticket: Ticket;
  title: string;
  place: string;
  onOpen: () => void;
}

/** Пульсирующая красная полоса аварии над очередью: заголовок, место, таймер и «Открыть». */
export function QueueAlarm({ ticket, title, place, onOpen }: QueueAlarmProps): JSX.Element {
  return (
    <Card className="queue-alarm" padded={false} as="section">
      <span className="queue-alarm__pulse" aria-hidden="true" />
      <div className="queue-alarm__text">
        <div className="queue-alarm__line">
          <span className="queue-alarm__label">Авария</span>
          <span className="queue-alarm__title">{title}</span>
        </div>
        <div className="queue-alarm__meta">
          № {ticket.number} · {place}
        </div>
      </div>
      <Timer from={ticket.createdAt} className="queue-alarm__timer" />
      <Button variant="secondary" size="sm" onClick={onOpen}>
        Открыть
      </Button>
    </Card>
  );
}

export interface QueueGroupProps {
  title: string;
  count: number;
  /** Пояснение справа от заголовка. */
  note?: ReactNode;
  /** Жёлтая полоса слева: «нужно ваше решение». */
  decision?: boolean;
  /** Кнопка массового действия справа. */
  action?: ReactNode;
  children: ReactNode;
}

/** Стеклянная группа строк с заголовком, счётчиком и действием. */
export function QueueGroup({
  title,
  count,
  note,
  decision = false,
  action,
  children,
}: QueueGroupProps): JSX.Element {
  return (
    <Card className={cx('queue-group', decision && 'queue-group--decision')} padded={false} as="section">
      <header className="queue-group__head">
        <h2 className="queue-group__title">{title}</h2>
        <span className="queue-group__count">{count}</span>
        <span className="queue-group__spacer" />
        {note && <span className="queue-group__note">{note}</span>}
        {action}
      </header>
      {children}
    </Card>
  );
}

export type QueueStateTone = 'accent' | 'info' | 'warn' | 'muted';

export interface QueueStateView {
  tone: QueueStateTone;
  text: string;
}

/** Статус строки точкой и текстом — без заливки (правило дизайн-системы). */
export function QueueState({ tone, text }: QueueStateView): JSX.Element {
  return (
    <span className={cx('queue-state', `queue-state--${tone}`)}>
      <i className="queue-state__dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Уверенность ИИ: шкала и процент; ниже порога — жёлтым. */
export function QueueConfidence({ value }: { value: number | null }): JSX.Element {
  if (value === null) return <span className="queue-conf queue-conf--empty">—</span>;
  const percent = Math.round(value * 100);
  return (
    <span className={cx('queue-conf', value < CONFIDENCE_THRESHOLD && 'queue-conf--warn')}>
      <span className="queue-conf__track" aria-hidden="true">
        <span className="queue-conf__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="queue-conf__value">{percent}%</span>
    </span>
  );
}

export interface QueueRowProps {
  ticket: Ticket;
  title: string;
  meta: string;
  /** Причина, почему нужен диспетчер: «Не ясно: категория, срочность». */
  why?: string | null;
  /** Шкала уверенности; не передаём для строк без уверенности. */
  confidence?: number | null;
  /** Точка-статус вместо уверенности. */
  state?: QueueStateView | null;
  wait: string;
  action?: ReactNode;
  /** Исполнитель справа вместо действия. */
  engineer?: string | null;
  selectable?: boolean;
  selected?: boolean;
  fresh?: boolean;
  onSelect?: () => void;
  variant?: 'decision' | 'ready' | 'engineer' | 'waiting';
}

/** Одна строка очереди: шар приоритета, заголовок, уверенность/статус, ожидание и действие. */
export function QueueRow({
  ticket,
  title,
  meta,
  why,
  confidence,
  state,
  wait,
  action,
  engineer,
  selectable = false,
  selected = false,
  fresh = false,
  onSelect,
  variant = 'ready',
}: QueueRowProps): JSX.Element {
  return (
    <div
      className={cx(
        'queue-row',
        `queue-row--${variant}`,
        selectable && 'queue-row--selectable',
        selected && 'queue-row--selected',
        fresh && 'queue-row--fresh',
      )}
      aria-current={selected ? 'true' : undefined}
      onClick={selectable ? onSelect : undefined}
    >
      <span className="queue-row__priority">
        <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} />
      </span>
      <div className="queue-row__text">
        <b className="queue-row__title">{title}</b>
        <small className="queue-row__meta">{meta}</small>
        {why && <span className="queue-row__why">{why}</span>}
      </div>
      <div className="queue-row__middle">
        {state ? (
          <QueueState {...state} />
        ) : confidence !== undefined ? (
          <QueueConfidence value={confidence} />
        ) : null}
      </div>
      <span className="queue-row__wait">{wait}</span>
      <div className="queue-row__action">
        {action ?? (engineer ? <QueueEngineer name={engineer} /> : null)}
      </div>
    </div>
  );
}

/** Исполнитель строкой: аватар-рожица и имя (шапка, расширенная группа «Ждут инженера»). */
export function QueueEngineer({ name }: { name: string }): JSX.Element {
  return (
    <span className="queue-engineer">
      <PersonAvatar name={name} size={28} />
      <span className="queue-engineer__name" title={name}>
        {name}
      </span>
    </span>
  );
}

export interface QueueFoldProps {
  title: string;
  count: number;
  /** Одна строка-перечисление, когда группа свёрнута. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Свёрнутая группа: заголовок и перечисление в одну строку, по клику раскрывается. */
export function QueueFold({ title, count, summary, open, onToggle, children }: QueueFoldProps): JSX.Element {
  return (
    <Card className="queue-group" padded={false} as="section">
      <button type="button" className="queue-fold__head" aria-expanded={open} onClick={onToggle}>
        <span className="queue-fold__chevron" aria-hidden="true">
          ›
        </span>
        <span className="queue-fold__title">{title}</span>
        <span className="queue-fold__count">{count}</span>
        {!open && summary !== '' && <span className="queue-fold__summary">{summary}</span>}
      </button>
      {open && (
        <div className="queue-fold__body" data-reveal>
          {children}
        </div>
      )}
    </Card>
  );
}
