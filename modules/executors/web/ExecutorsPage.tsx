import { shortTicketNumber } from '@ugra/contracts';
import './executors.css';
import type { EngineerInfo, EngineersResponse, Ticket, TicketListResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  PersonAvatar,
  PriorityMark,
  SearchField,
  Segmented,
  cx,
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

/** Вкладка фильтра смены: «на смене» или весь справочник. */
type ShiftView = 'shift' | 'all';

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

/** Полоса загрузки: пять делений, закрашенных по числу задач, и подпись «N/5». */
function LoadBar({ load }: { load: ReturnType<typeof loadState> }): JSX.Element {
  return (
    <span className="exec-load">
      <span className="exec-bar" role="img" aria-label={`Загрузка: ${load.text}, ${load.hint}`}>
        {Array.from({ length: load.threshold }, (_unused, index) => {
          const on = index < load.filled;
          return (
            <span
              key={index}
              className={
                on ? cx('exec-bar__seg', 'exec-bar__seg--on', `exec-bar__seg--${load.tone}`) : 'exec-bar__seg'
              }
            />
          );
        })}
      </span>
      <span className={cx('exec-load__value', `exec-load__value--${load.tone}`)} aria-hidden="true">
        {load.count}/{load.threshold}
      </span>
      {load.overloaded && (
        <span className="exec-load__flag" aria-hidden="true">
          перегруз
        </span>
      )}
    </span>
  );
}

interface EngineerCardProps {
  engineer: EngineerInfo;
  department: string;
  selected: boolean;
  onSelect: () => void;
}

/** Карточка исполнителя: кто это, на смене ли, сколько задач и что умеет. */
function EngineerCard({ engineer, department, selected, onSelect }: EngineerCardProps): JSX.Element {
  const load = loadState(engineer.openTickets);
  const chips = skillChips(engineer.skills);
  const buildings = engineer.buildings.length > 0 ? engineer.buildings.join(', ') : 'не указаны';

  return (
    <button
      type="button"
      className={cx(
        'ugra-card',
        'exec-card',
        !engineer.onShift && 'exec-card--off',
        selected && 'exec-card--selected',
      )}
      aria-pressed={selected}
      data-reveal
      onClick={onSelect}
    >
      <span className="exec-card__inner">
        <span className="exec-card__head">
          <span className="exec-avatar">
            <PersonAvatar name={engineer.fullName} size={48} />
            <span
              className={engineer.onShift ? 'exec-avatar__dot exec-avatar__dot--on' : 'exec-avatar__dot'}
              aria-hidden="true"
            />
          </span>
          <span className="exec-card__who">
            <span className="exec-card__name">{engineer.fullName}</span>
            <span className="exec-card__dep">
              {engineer.onShift ? 'на смене' : 'не на смене'} · {department}
            </span>
          </span>
        </span>

        <LoadBar load={load} />

        {chips.length > 0 && (
          <span className="exec-skills" aria-label="Навыки">
            {chips.map((chip) => (
              <Chip
                key={chip.code}
                className="exec-skill"
                title={`${chip.label}: уровень ${chip.level} из 5`}
              >
                {chip.label}
              </Chip>
            ))}
          </span>
        )}

        <span className="exec-meta">
          <span>{gradeLabel(engineer.level)}</span>
          <span>Корпуса: {buildings}</span>
          <span>Решено похожих: {engineer.resolvedSimilar}</span>
        </span>
      </span>
    </button>
  );
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
                  <span className="exec-task__number">№ {shortTicketNumber(ticket.number)}</span>
                  <span className="exec-task__title">{categoryLabel(meta, ticket.category)}</span>
                  <Badge tone={ticketStatusTone(ticket.status)}>{formatTicketStatus(ticket.status)}</Badge>
                  <span className={`exec-task__due${due === null ? '' : ` exec-task__due--${due.tone}`}`}>
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

/** Экран 08 «Исполнители»: кто на смене, чем занят и что умеет; клик — текущие задачи. */
export function ExecutorsPage({ api, meta, navigate, trackAction }: WebPageProps): JSX.Element {
  const [engineers, setEngineers] = useState<EngineersResponse['engineers']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<EngineerFilters>(DEFAULT_ENGINEER_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

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
    return [...names.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], 'ru'))
      .map(([value, label]) => ({ value, label }));
  }, [engineers, meta.dictionaries]);

  const visible = useMemo(
    () => sortEngineers(filterEngineers(engineers, filters, { departmentLabel: departmentOf })),
    [engineers, filters, meta.dictionaries],
  );

  useListMotion(gridRef, !loading && visible.length > 0);

  const onShiftCount = useMemo(() => engineers.filter((engineer) => engineer.onShift).length, [engineers]);

  const selected = selectedId ? (engineers.find((engineer) => engineer.id === selectedId) ?? null) : null;

  useEffect(() => {
    if (!selectedId) return;
    if (!visible.some((engineer) => engineer.id === selectedId)) setSelectedId(null);
  }, [visible, selectedId]);

  const shiftView: ShiftView = filters.onlyOnShift ? 'shift' : 'all';
  const filtersActive =
    filters.department !== ALL_DEPARTMENTS || !filters.onlyOnShift || filters.query.trim() !== '';
  const resetFilters = (): void => setFilters(DEFAULT_ENGINEER_FILTERS);

  return (
    <div className="exec-page">
      <header className="exec-head" data-reveal>
        <h1 className="ugra-page-title">Исполнители</h1>
        <div className="exec-tools">
          <Segmented
            value={shiftView}
            label="Кто на смене"
            options={[
              { value: 'shift', label: 'На смене', count: onShiftCount },
              { value: 'all', label: 'Все', count: engineers.length },
            ]}
            onChange={(view) => {
              setFilters((previous) => ({ ...previous, onlyOnShift: view === 'shift' }));
              trackAction?.('select');
            }}
          />
          <SearchField
            value={filters.query}
            label="Поиск исполнителей"
            placeholder="Имя или навык"
            onChange={(query) => {
              setFilters((previous) => ({ ...previous, query }));
              trackAction?.('input');
            }}
          />
        </div>
      </header>

      {!loading && error === null && departmentOptions.length > 1 && (
        <div className="exec-deps" role="group" aria-label="Подразделение" data-reveal>
          <Chip
            active={filters.department === ALL_DEPARTMENTS}
            onClick={() => {
              setFilters((previous) => ({ ...previous, department: ALL_DEPARTMENTS }));
              trackAction?.('select');
            }}
          >
            Все отделы
          </Chip>
          {departmentOptions.map((option) => (
            <Chip
              key={option.value}
              active={filters.department === option.value}
              onClick={() => {
                setFilters((previous) => ({ ...previous, department: option.value }));
                trackAction?.('select');
              }}
            >
              {option.label}
            </Chip>
          ))}
          {filtersActive && visible.length > 0 && (
            <button type="button" className="exec-reset" onClick={resetFilters}>
              Сбросить
            </button>
          )}
        </div>
      )}

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
          icon={<Icon name="executors" size={28} />}
        />
      )}

      {!loading && error === null && engineers.length > 0 && visible.length === 0 && (
        <EmptyState
          title="Под фильтры никто не подошёл"
          hint="Измените подразделение, переключитесь на «Все» или очистите поиск."
        >
          <Button variant="secondary" size="sm" onClick={resetFilters}>
            Сбросить фильтры
          </Button>
        </EmptyState>
      )}

      {!loading && error === null && visible.length > 0 && (
        <div className="exec-grid" ref={gridRef}>
          {visible.map((engineer) => (
            <EngineerCard
              key={engineer.id}
              engineer={engineer}
              department={departmentOf(engineer.departmentId)}
              selected={engineer.id === selectedId}
              onSelect={() => {
                setSelectedId(engineer.id === selectedId ? null : engineer.id);
                trackAction?.('select');
              }}
            />
          ))}
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
    </div>
  );
}
