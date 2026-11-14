import './dashboard.css';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebPageProps } from '@ugra/ui';
import { Icon } from '@ugra/ui';
import type { OverviewFiltersState } from './api';
import { overviewQuery } from './api';
import { formatDateRange, isValidRange, periodTitle } from './format';
import { OverdueDrawer } from './OverdueDrawer';
import { buildFilterOptions, EXPORT_ITEMS, mergeOptions, slicesToOptions } from './options';
import type { SelectOption } from './options';
import { PriorityCards } from './PriorityCards';
import { TilesWidget } from './TilesWidget';
import { useOverview } from './useOverview';

/** Страница `/dashboard`: 5 карточек приоритетов и 3 плитки периода (макет D2). */

const PERIODS: readonly { days: number; label: string }[] = [
  { days: 1, label: 'Смена' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: 'Квартал' },
];

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="rd-filter">
      <span className="rd-filter__label">{label}</span>
      <select
        className="rd-filter__select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">все</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DashboardPage({ meta }: WebPageProps): JSX.Element {
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<OverviewFiltersState>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [assignees, setAssignees] = useState<SelectOption[]>([]);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const rangeReady = isValidRange(from, to);
  const query = useMemo(() => overviewQuery(days, from, to, filters), [days, from, to, filters]);
  const { data, loading, error } = useOverview(query);

  useEffect(() => {
    if (!data) return;
    setAssignees((current) => mergeOptions(current, slicesToOptions(data.byAssignee)));
  }, [data]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      const node = exportRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setExportOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportOpen]);

  const options = useMemo(() => buildFilterOptions(meta, data, assignees), [meta, data, assignees]);
  const activeFilters = Object.keys(filters).length;
  const periodLabel = periodTitle(days, from, to);
  const compareLabel = data ? formatDateRange(data.previousPeriod.from, data.previousPeriod.to) : null;

  const patch = (key: keyof OverviewFiltersState) => (value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const pickPeriod = (nextDays: number): void => {
    setFrom('');
    setTo('');
    setDays(nextDays);
  };

  return (
    <div className="rd-page">
      <div className="rd-top" data-reveal>
        <h1 className="rd-title">Обращения за {periodLabel}</h1>

        <div className="rd-controls">
          <div className="rd-periods" role="group" aria-label="Период">
            {PERIODS.map((period) => {
              const active = !rangeReady && days === period.days;
              return (
                <button
                  key={period.days}
                  type="button"
                  className={active ? 'rd-period rd-period--on' : 'rd-period'}
                  onClick={() => pickPeriod(period.days)}
                  aria-pressed={active}
                >
                  {period.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={activeFilters > 0 ? 'rd-chip rd-chip--on' : 'rd-chip'}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <Icon name="reports" size={16} />
            Фильтры
            {activeFilters > 0 && <span className="rd-chip__count">{activeFilters}</span>}
          </button>

          <div className="rd-export" ref={exportRef}>
            <button
              type="button"
              className="rd-chip rd-chip--icon"
              onClick={() => setExportOpen((open) => !open)}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              aria-label="Выгрузить"
              title="Выгрузить"
            >
              <Icon name="tasks" size={16} />
            </button>
            {exportOpen && (
              <div className="rd-menu" role="menu" aria-label="Выгрузка">
                {EXPORT_ITEMS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    title={item.title}
                    className="rd-menu__item"
                  >
                    <span>{item.label}</span>
                    <span className="rd-menu__hint">{item.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {filtersOpen && (
        <div className="rd-filters" data-motion="off">
          <Select label="Категория" value={filters.category ?? ''} options={options.categories} onChange={patch('category')} />
          <Select label="Исполнитель" value={filters.assigneeId ?? ''} options={options.assignees} onChange={patch('assigneeId')} />
          <Select label="Канал" value={filters.channel ?? ''} options={options.channels} onChange={patch('channel')} />
          <Select label="Корпус" value={filters.building ?? ''} options={options.buildings} onChange={patch('building')} />
          <Select label="Статус" value={filters.status ?? ''} options={options.statuses} onChange={patch('status')} />
          <label className="rd-range">
            <span className="rd-range__label">Даты</span>
            <input
              type="date"
              className="rd-range__input"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Дата начала"
            />
            <input
              type="date"
              className="rd-range__input"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Дата конца"
            />
          </label>
          {activeFilters > 0 && (
            <button
              type="button"
              className="ugra-btn ugra-btn--ghost ugra-btn--sm"
              onClick={() => setFilters({})}
            >
              Сбросить
            </button>
          )}
        </div>
      )}

      {loading && !data && <div className="rd-placeholder">Считаем показатели…</div>}
      {error && <div className="rd-placeholder rd-placeholder--error">{error}</div>}

      {data && (
        <>
          <PriorityCards
            slices={data.byPriority}
            previous={data.previousByPriority}
            periodDays={data.period.days}
          />
          <TilesWidget
            overview={data}
            fetchOwn={false}
            onOverdue={() => setOverdueOpen(true)}
          />
          {compareLabel && (
            <p className="rd-compare" data-motion="off">
              Сравнение с прошлым периодом: {compareLabel}
            </p>
          )}
        </>
      )}

      <OverdueDrawer
        open={overdueOpen}
        onClose={() => setOverdueOpen(false)}
        query={query}
        reason={data?.insights.sla ?? null}
      />
    </div>
  );
}
