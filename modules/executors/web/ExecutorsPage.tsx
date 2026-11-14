import './executors.css';
import type { EngineersResponse, Ticket, TicketListResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  PersonAvatar,
  PriorityMark,
  SearchField,
  Segmented,
  formatDateTime,
  formatTicketStatus,
  ticketStatusTone,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  ALL_DEPARTMENTS,
  DEFAULT_ENGINEER_FILTERS,
  departmentLabel,
  filterEngineers,
  gradeLabel,
  loadState,
  skillChips,
  sortEngineers,
  taskDeadline,
} from './format';
import type { EngineerFilters } from './format';

/** Сколько задач показываем в панели выбранного исполнителя. */
const TASKS_LIMIT = 20;
const SKELETON_CARDS = 6;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActive(ticket: Ticket): boolean {
  return ticket.status !== 'closed' && ticket.status !== 'cancelled';
}

function categoryLabel(meta: WebPageProps['meta'], code: string | null): string {
  if (!code) return 'Без категории';
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code);
  return item?.label ?? code;
}

interface TasksState {
  loading: boolean;
  error: string | null;
  tickets: Ticket[];
}

interface CurrentTasksProps {
  engineerId: string;
  fullName: string;
  department: string;
  api: WebPageProps['api'];
  meta: WebPageProps['meta'];
  navigate: WebPageProps['navigate'];
  trackAction?: WebPageProps['trackAction'];
  onClose: () => void;
}

/** Панель «Текущие задачи» выбранного исполнителя: заявки из `/api/tickets?assigneeId`. */
function CurrentTasks({
  engineerId,
  fullName,
  department,
  api,
  meta,
  navigate,
  trackAction,
  onClose,
}: CurrentTasksProps): JSX.Element {
  const [state, setState] = useState<TasksState>({ loading: true, error: null, tickets: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, tickets: [] });
    api
      .get<TicketListResponse>(
        `/api/tickets?assigneeId=${encodeURIComponent(engineerId)}&limit=${TASKS_LIMIT}`,
      )
      .then((response) => {
        if (alive) {
          setState({ loading: false, error: null, tickets: response.tickets.filter(isActive) });
        }
      })
      .catch((cause: unknown) => {
        if (alive) setState({ loading: false, error: errorText(cause), tickets: [] });
      });
    return () => {
      alive = false;
    };
  }, [api, engineerId, reloadKey]);

  useListMotion(listRef, state.tickets.length > 0);

  return (
    <section className="ugra-card exec-panel" data-reveal aria-labelledby="exec-tasks-title">
      <header className="exec-panel__head">
        <div className="exec-panel__who">
          <PersonAvatar name={fullName} size={36} />
          <div>
            <h2 className="exec-panel__title" id="exec-tasks-title">
              Текущие задачи
            </h2>
            <p className="exec-panel__sub">
              {fullName} · {department}
            </p>
          </div>
        </div>
        <div className="exec-panel__right">
          {state.loading && <Badge>загружаем</Badge>}
          {!state.loading && state.error === null && state.tickets.length > 0 && (
            <Badge>{state.tickets.length} в работе</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </header>

      {state.loading && (
        <div className="exec-panel__skeleton" role="status" aria-label="Загружаем задачи">
          <span />
          <span />
          <span />
        </div>
      )}

      {!state.loading && state.error !== null && (
        <div className="exec-panel__error" role="alert">
          <p>Не удалось загрузить задачи: {state.error}</p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Повторить
          </Button>
        </div>
      )}

      {!state.loading && state.error === null && state.tickets.length === 0 && (
        <EmptyState
          title="Текущих задач нет"
          hint="Исполнитель свободен — ИИ предложит его первым, когда заявка подойдёт по навыкам."
        />
      )}

      {!state.loading && state.error === null && state.tickets.length > 0 && (
        <ul className="exec-tasks" ref={listRef}>
          {state.tickets.map((ticket) => {
            const due = taskDeadline(ticket, Date.now());
            return (
              <li className="exec-task" key={ticket.id}>
                <a
                  className="exec-task__link"
                  href={`#/review?id=${encodeURIComponent(ticket.id)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/review?id=${encodeURIComponent(ticket.id)}`);
                    trackAction?.('navigate');
                  }}
                >
                  <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} />
                  <span className="exec-task__number">№ {ticket.number}</span>
                  <span className="exec-task__title">{categoryLabel(meta, ticket.category)}</span>
                  <Badge tone={ticketStatusTone(ticket.status)}>{formatTicketStatus(ticket.status)}</Badge>
                  <span
                    className={`exec-task__due${
                      due === null ? ' exec-task__due--empty' : ` exec-task__due--${due.tone}`
                    }`}
                  >
                    {due === null
                      ? 'срок не задан'
                      : due.overdue
                        ? `просрочен · ${formatDateTime(due.at)}`
                        : `до ${formatDateTime(due.at)}`}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Экран 12 «Исполнители»: кто на смене, чем занят и что умеет; клик — текущие задачи. */
export function ExecutorsPage({ api, meta, navigate, trackAction }: WebPageProps): JSX.Element {
  const [engineers, setEngineers] = useState<EngineersResponse['engineers']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<EngineerFilters>(DEFAULT_ENGINEER_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<EngineersResponse>('/api/engineers')
      .then((response) => {
        if (alive) {
          setEngineers(response.engineers);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setEngineers([]);
          setError(errorText(cause));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [api, reloadKey]);

  const departmentOf = (departmentId: string | null): string =>
    departmentLabel(meta.dictionaries, departmentId);

  const departmentOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const engineer of engineers) {
      if (!engineer.departmentId) continue;
      names.set(engineer.departmentId, departmentLabel(meta.dictionaries, engineer.departmentId));
    }
    return [
      { value: ALL_DEPARTMENTS, label: 'Все', count: engineers.length },
      ...[...names.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], 'ru'))
        .map(([code, label]) => ({
          value: code,
          label,
          count: engineers.filter((engineer) => engineer.departmentId === code).length,
        })),
    ];
  }, [engineers, meta.dictionaries]);

  const visible = useMemo(
    () => sortEngineers(filterEngineers(engineers, filters, { departmentLabel: departmentOf })),
    [engineers, filters, meta.dictionaries],
  );

  const selected = selectedId ? (engineers.find((engineer) => engineer.id === selectedId) ?? null) : null;

  useEffect(() => {
    if (!selectedId) return;
    if (!visible.some((engineer) => engineer.id === selectedId)) setSelectedId(null);
  }, [visible, selectedId]);

  const filtersActive =
    filters.department !== ALL_DEPARTMENTS || filters.onlyOnShift || filters.query.trim() !== '';

  return (
    <div className="exec-page">
      <header className="exec-head" data-reveal>
        <div>
          <h1 className="ugra-page-title">Исполнители</h1>
          <p className="exec-lead">
            Кто на смене, чем занят и что умеет. ИИ учитывает это, когда предлагает исполнителя.
          </p>
        </div>
      </header>

      <Card className="exec-toolbar" padded={false}>
        <div className="exec-toolbar__inner">
          <Segmented
            value={filters.department}
            label="Подразделение"
            onChange={(department) => {
              setFilters((previous) => ({ ...previous, department }));
              trackAction?.('select');
            }}
            options={departmentOptions}
          />
          <div className="exec-toolbar__right">
            <Chip
              active={filters.onlyOnShift}
              onClick={() => {
                setFilters((previous) => ({ ...previous, onlyOnShift: !previous.onlyOnShift }));
                trackAction?.('select');
              }}
              title="Показать только тех, кто сейчас на смене"
            >
              Только на смене
            </Chip>
            <SearchField
              value={filters.query}
              label="Поиск исполнителей"
              placeholder="Имя, навык, корпус"
              onChange={(query) => {
                setFilters((previous) => ({ ...previous, query }));
                trackAction?.('input');
              }}
            />
          </div>
        </div>
      </Card>

      {error !== null && (
        <Card tone="danger">
          <h2>API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Повторить
          </Button>
        </Card>
      )}

      {loading && (
        <div className="exec-grid" aria-label="Загружаем исполнителей" aria-busy="true">
          {Array.from({ length: SKELETON_CARDS }, (_unused, index) => (
            <span className="exec-skeleton" key={index} />
          ))}
        </div>
      )}

      {!loading && error === null && engineers.length === 0 && (
        <EmptyState
          title="Исполнителей нет"
          hint="В справочнике инженеров пусто: карточки появятся, когда появятся данные о людях и навыках."
          icon="👥"
        />
      )}

      {!loading && error === null && engineers.length > 0 && visible.length === 0 && (
        <EmptyState
          title="Под фильтры никто не подошёл"
          hint="Измените подразделение, снимите «Только на смене» или очистите поиск."
        >
          <Button variant="secondary" size="sm" onClick={() => setFilters(DEFAULT_ENGINEER_FILTERS)}>
            Сбросить фильтры
          </Button>
        </EmptyState>
      )}

      {!loading && error === null && visible.length > 0 && (
        <div className="exec-grid">
          {visible.map((engineer) => {
            const load = loadState(engineer.openTickets);
            const chips = skillChips(engineer.skills);
            const isSelected = engineer.id === selectedId;
            return (
              <button
                key={engineer.id}
                type="button"
                className={isSelected ? 'ugra-card exec-card exec-card--selected' : 'ugra-card exec-card'}
                aria-pressed={isSelected}
                data-reveal
                onClick={() => {
                  setSelectedId(isSelected ? null : engineer.id);
                  trackAction?.('select');
                }}
              >
                <span className="exec-card__top">
                  <PersonAvatar name={engineer.fullName} size={44} />
                  <span className="exec-card__who">
                    <span className="exec-card__name">{engineer.fullName}</span>
                    <span className="exec-card__dep">{departmentOf(engineer.departmentId)}</span>
                    <Badge className="exec-card__grade">{gradeLabel(engineer.level)}</Badge>
                  </span>
                </span>

                <span className="exec-shift">
                  <span
                    className={engineer.onShift ? 'exec-dot exec-dot--on' : 'exec-dot'}
                    aria-hidden="true"
                  />
                  {engineer.onShift ? 'на смене' : 'не на смене'}
                </span>

                <span className="exec-load">
                  <span className="exec-load__label">Загрузка</span>
                  <span className={`exec-load__value exec-load__value--${load.tone}`}>
                    {load.text}
                    {load.overloaded ? ' · перегруз' : ''}
                  </span>
                </span>
                <span className="exec-bar" role="img" aria-label={`Загрузка: ${load.text}, ${load.hint}`}>
                  <span
                    className={`exec-bar__fill exec-bar__fill--${load.tone}`}
                    style={{ width: `${load.percent}%` }}
                  />
                </span>

                {chips.length > 0 && (
                  <span className="exec-skills" aria-label="Навыки">
                    {chips.map((chip) => (
                      <Chip
                        key={chip.code}
                        className="exec-skill"
                        title={`${chip.label}: уровень ${chip.level} из 5`}
                      >
                        {chip.label}
                        <span className="exec-skill__level" aria-label={`уровень ${chip.level} из 5`}>
                          {chip.level}
                        </span>
                      </Chip>
                    ))}
                  </span>
                )}

                <span className="exec-meta">
                  <span>
                    Корпуса: {engineer.buildings.length > 0 ? engineer.buildings.join(', ') : 'не указаны'}
                  </span>
                  <span>Решено похожих: {engineer.resolvedSimilar}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <CurrentTasks
          key={selected.id}
          engineerId={selected.id}
          fullName={selected.fullName}
          department={departmentOf(selected.departmentId)}
          api={api}
          meta={meta}
          navigate={navigate}
          trackAction={trackAction}
          onClose={() => {
            setSelectedId(null);
            trackAction?.('click');
          }}
        />
      )}

      {filtersActive && !loading && visible.length > 0 && (
        <div className="exec-hint">
          <span className="ugra-dim">
            Показано {visible.length} из {engineers.length}
          </span>
          <button
            type="button"
            className="exec-hint__reset"
            onClick={() => setFilters(DEFAULT_ENGINEER_FILTERS)}
          >
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  );
}
