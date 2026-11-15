import type { Ticket } from '@ugra/contracts';
import type { JSX, Ref, ReactNode } from 'react';
import {
  Button,
  Card,
  DetailRow,
  PersonAvatar,
  Timer,
  formatTicketNumber,
  cx,
} from '@ugra/ui';
import { CONFIDENCE_THRESHOLD } from './format';
import { DeadlineChips, Kbd } from './parts';

/**
 * Части доски «Очередь»: полоса аварии, колонка карточек, карточка заявки,
 * свёрнутая полоса ожидания и карточка-деталь. Оформление — классы `queue-*`
 * из `review.css`; цвета только из токенов `@ugra/ui`.
 */

export interface QueueAlarmProps {
  ticket: Ticket;
  title: string;
  place: string;
  onOpen: () => void;
}

/** Пульсирующая полоса аварии над доской: заголовок, место, таймер и «Открыть». */
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
          {formatTicketNumber(ticket.number)} · {place}
        </div>
      </div>
      <Timer from={ticket.createdAt} className="queue-alarm__timer" />
      <Button variant="secondary" size="sm" onClick={onOpen}>
        Открыть
      </Button>
    </Card>
  );
}

export type QueueStateTone = 'accent' | 'info' | 'warn' | 'muted' | 'danger' | 'ok' | 'neutral';

export interface QueueStateView {
  tone: QueueStateTone;
  text: string;
}

/** Статус строки точкой и текстом — без заливки (правило дизайн-системы). */
export function QueueState({ tone, text, className }: QueueStateView & { className?: string }): JSX.Element {
  return (
    <span className={cx('queue-state', `queue-state--${tone}`, className)}>
      <i className="queue-state__dot" aria-hidden="true" />
      <span className="queue-state__text">{text}</span>
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

export interface QueueColumnProps {
  title: string;
  count: number;
  /** Пояснение под заголовком колонки. */
  note?: string;
  /** Действие колонки: «Подтвердить все» у готовых. */
  action?: ReactNode;
  /** Текст пустой колонки. */
  empty: string;
  /** Контейнер карточек — для `useListMotion`. */
  listRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}

/** Колонка доски: заголовок со счётчиком и стопка карточек с отступами. */
export function QueueColumn({
  title,
  count,
  note,
  action,
  empty,
  listRef,
  children,
}: QueueColumnProps): JSX.Element {
  return (
    <section className="queue-column" aria-label={`${title}: ${count}`}>
      <header className="queue-column__head">
        <h2 className="queue-column__title">{title}</h2>
        <span className="queue-column__count">{count}</span>
        {note && <span className="queue-column__note">{note}</span>}
        <span className="queue-column__spacer" />
        {action}
      </header>
      <div className="queue-column__list" ref={listRef}>
        {count === 0 ? <p className="queue-column__empty">{empty}</p> : children}
      </div>
    </section>
  );
}

export interface QueueCardProps {
  ticket: Ticket;
  title: string;
  place: string;
  /** «Что сделать»: точка-статус и фраза. */
  state: QueueStateView;
  confidence: number | null;
  /** Сколько ждёт: «1 ч 14 мин». */
  wait: string;
  fresh?: boolean;
  selected?: boolean;
  onOpen: () => void;
}

/** Карточка заявки на доске: номер, заголовок, место, «что сделать» и уверенность. */
export function QueueCard({
  ticket,
  title,
  place,
  state,
  confidence,
  wait,
  fresh = false,
  selected = false,
  onOpen,
}: QueueCardProps): JSX.Element {
  const number = formatTicketNumber(ticket.number);
  return (
    <Card
      as="article"
      padded={false}
      className={cx(
        'queue-card',
        ticket.isEmergency && 'queue-card--emergency',
        selected && 'queue-card--selected',
        fresh && 'queue-card--fresh',
      )}
    >
      <button
        type="button"
        className="queue-card__hit"
        aria-label={`Открыть карточку ${number}: ${title}`}
        onClick={onOpen}
      />
      <div className="queue-card__top">
        <span className="queue-card__num">{number}</span>
        <span className="queue-card__place">{place}</span>
        <span className="queue-card__wait" title={`Ждёт с ${ticket.createdAt}`}>
          {wait}
        </span>
      </div>
      <h3 className="queue-card__title">{title}</h3>
      <div className="queue-card__foot">
        <QueueState {...state} className="queue-card__state" />
        <QueueConfidence value={confidence} />
      </div>
    </Card>
  );
}

/** Исполнитель строкой: аватар-рожица и имя. */
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

export interface QueueQuietItem {
  id: string;
  title: string;
  /** Номер заявки как есть: «З-20261114-0601». */
  number: string;
  /** Подпись справа: исполнитель или статус. */
  note?: string | null;
  onOpen: () => void;
}

export interface QueueQuietGroupView {
  key: string;
  title: string;
  count: number;
  summary: string;
  open: boolean;
  onToggle: () => void;
  items: QueueQuietItem[];
  listRef?: Ref<HTMLDivElement>;
}

export interface QueueQuietProps {
  groups: QueueQuietGroupView[];
}

/**
 * Компактная полоса под доской: «Ждут инженера / заявителя / ИИ разбирает».
 * Каждая строка свёрнута в одну линию и раскрывается по клику.
 */
export function QueueQuiet({ groups }: QueueQuietProps): JSX.Element | null {
  const visible = groups.filter((group) => group.count > 0);
  if (visible.length === 0) return null;
  return (
    <Card className="queue-quiet" padded={false} as="section">
      <h2 className="queue-quiet__caption">Дальше по очереди</h2>
      {visible.map((group) => (
        <div className="queue-quiet__group" key={group.key}>
          <button
            type="button"
            className="queue-quiet__head"
            aria-expanded={group.open}
            onClick={group.onToggle}
          >
            <span className="queue-quiet__chevron" aria-hidden="true">
              ›
            </span>
            <span className="queue-quiet__title">{group.title}</span>
            <span className="queue-quiet__count">{group.count}</span>
            {!group.open && group.summary !== '' && (
              <span className="queue-quiet__summary">{group.summary}</span>
            )}
          </button>
          {group.open && (
            <div className="queue-quiet__list" ref={group.listRef}>
              {group.items.map((item) => (
                <button
                  type="button"
                  className="queue-quiet__item"
                  key={item.id}
                  onClick={item.onOpen}
                >
                  <span className="queue-quiet__item-num">{formatTicketNumber(item.number)}</span>
                  <span className="queue-quiet__item-title">{item.title}</span>
                  {item.note && <span className="queue-quiet__item-note">{item.note}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

export interface QueueDetailField {
  key: string;
  label: string;
  value: string | null;
  /** Поле помечено «на проверку». */
  review: boolean;
}

export interface QueueCandidateView {
  name: string;
  /** Почему ИИ предлагает этого инженера. */
  reasons: string[];
}

export interface QueueDetailAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

export interface QueueDetailProps {
  ticket: Ticket;
  title: string;
  place: string;
  state: QueueStateView;
  /** «Ждёт 1 ч 14 мин». */
  wait: string;
  /** Когда создана: «14 ноя, 09:12». */
  created: string;
  /** Почему нужен диспетчер: «Не ясно: категория, срочность». */
  note?: string | null;
  fields: QueueDetailField[];
  /** Уже назначенный исполнитель. */
  assignee: string | null;
  /** Предложенный ИИ исполнитель. */
  candidate: QueueCandidateView | null;
  now: number;
  primary?: QueueDetailAction;
  secondary?: QueueDetailAction;
  /** Подсказка про Enter доступна только для готовой к подтверждению заявки. */
  canConfirm: boolean;
  onClose: () => void;
  /** Фокус переносится в панель при открытии. */
  panelRef?: Ref<HTMLDivElement>;
}

/** Карточка-деталь: поля заявки, предложение исполнителя и кнопки действий. */
export function QueueDetail({
  ticket,
  title,
  place,
  state,
  wait,
  created,
  note,
  fields,
  assignee,
  candidate,
  now,
  primary,
  secondary,
  canConfirm,
  onClose,
  panelRef,
}: QueueDetailProps): JSX.Element {
  return (
    <aside
      className="queue-detail"
      role="dialog"
      aria-modal="true"
      aria-label={`Заявка ${formatTicketNumber(ticket.number)}`}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="queue-detail__head">
        <span className="queue-detail__num">{formatTicketNumber(ticket.number)}</span>
        <QueueState {...state} />
        <button type="button" className="queue-detail__close" aria-label="Закрыть карточку" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="queue-detail__intro">
        <h2 className="queue-detail__title">{title}</h2>
        <p className="queue-detail__meta">
          {place} · создана {created} · ждёт {wait}
        </p>
        {note && <p className="queue-detail__note">{note}</p>}
      </div>

      <DeadlineChips ticket={ticket} now={now} className="queue-detail__deadlines" />

      {fields.length > 0 && (
        <section className="queue-detail__section">
          <h3 className="queue-detail__label">Поля заявки</h3>
          <div className="queue-detail__fields">
            {fields.map((field) => (
              <DetailRow
                key={field.key}
                label={field.label}
                value={field.value ?? '—'}
                tone={field.review ? 'warn' : 'default'}
              />
            ))}
          </div>
        </section>
      )}

      <section className="queue-detail__section">
        <h3 className="queue-detail__label">
          Исполнитель
          {candidate && !assignee && <span className="queue-detail__tag">предложен ИИ</span>}
        </h3>
        {assignee ? (
          <div className="queue-detail__candidate">
            <PersonAvatar name={assignee} size={36} />
            <span className="queue-detail__candidate-name">{assignee}</span>
            <span className="queue-detail__candidate-pct">назначен</span>
          </div>
        ) : candidate ? (
          <div className="queue-detail__candidate">
            <PersonAvatar name={candidate.name} size={36} />
            <span className="queue-detail__candidate-text">
              <span className="queue-detail__candidate-name">{candidate.name}</span>
              <span className="queue-detail__candidate-note">
                {candidate.reasons.length > 0 ? candidate.reasons.join(' · ') : 'подобран по навыкам и загрузке'}
              </span>
            </span>
          </div>
        ) : (
          <p className="queue-detail__empty">Исполнитель не подобран — выберите на проверке.</p>
        )}
      </section>

      <div className="queue-detail__actions">
        {primary && (
          <Button
            variant="primary"
            onClick={primary.onClick}
            loading={primary.loading}
            disabled={primary.loading}
          >
            {primary.label}
          </Button>
        )}
        {secondary && (
          <Button variant="secondary" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>

      <p className="queue-detail__hint">
        {canConfirm ? (
          <>
            <Kbd>Enter</Kbd> — подтвердить
          </>
        ) : (
          <>
            <Kbd>Esc</Kbd> — закрыть
          </>
        )}
      </p>
    </aside>
  );
}
