import './dashboard.css';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebPageProps } from '@ugra/ui';
import type { OverviewFiltersState } from './api';
import { overviewQuery } from './api';
import {
  formatDateRange,
  isValidRange,
  periodName,
  periodTitle,
} from './format';
import { MainWidget } from './MainWidget';
import {
  buildFilterOptions,
  EXPORT_ITEMS,
  mergeOptions,
  slicesToOptions,
} from './options';
import type { SelectOption } from './options';
import { TilesWidget } from './TilesWidget';
import { useOverview } from './useOverview';

/** Страница `/dashboard`: период, фильтры, выгрузка, плитки и основной блок. */

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

/** Дашборд руководителя: один запрос к маршруту отчёта, виджеты получают готовые данные. */
export function DashboardPage({ meta }: WebPageProps): JSX.Element {
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<OverviewFiltersState>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [assignees, setAssignees] = useState<SelectOption[]>([]);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const rangeReady = isValidRange(from, to);
  const rangeBroken = from !== '' && to !== '' && !rangeReady;
  const query = useMemo(
    () => overviewQuery(days, from, to, filters),
    [days, from, to, filters],
  );
  const { data, loading, error } = useOverview(query);

  useEffect(() => {
    if (!data) return;
    setAssignees((current) => mergeOptions(current, slicesToOptions(data.byAssignee)));
  }, [data]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      const node = exportRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setExportOpen(false);
      }
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
  const previousLabel = data
    ? formatDateRange(data.previousPeriod.from, data.previousPeriod.to)
    : periodName(days);

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
      <div className="rd-head">
        <div className="rd-head__titles">
          <h1 className="ugra-page-title rd-title">Обращения за {periodTitle(days, from, to)}</h1>
          <p className="rd-head__subtitle">
            Сравнение с прошлым таким же периодом: {previousLabel}. Клик по цифре откроет заявки.
          </p>
        </div>

        <div className="rd-controls">
          <div className="rd-periods ugra-liquid" role="group" aria-label="Период">
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
            <span className="rd-range__dash" aria-hidden="true">
              —
            </span>
            <input
              type="date"
              className="rd-range__input"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Дата конца"
            />
          </label>

          <div className="rd-export" ref={exportRef}>
            <button
              type="button"
              className="ugra-btn ugra-btn--primary rd-export__button"
              onClick={() => setExportOpen((open) => !open)}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
            >
              Выгрузить
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
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
                <p className="rd-menu__note">Выгрузка появится с отчётами О1–О8.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rd-filters">
        <span className="rd-filters__label">Фильтры</span>
        <Select label="Категория" value={filters.category ?? ''} options={options.categories} onChange={patch('category')} />
        <Select label="Исполнитель" value={filters.assigneeId ?? ''} options={options.assignees} onChange={patch('assigneeId')} />
        <Select label="Канал" value={filters.channel ?? ''} options={options.channels} onChange={patch('channel')} />
        <Select label="Корпус" value={filters.building ?? ''} options={options.buildings} onChange={patch('building')} />
        <Select label="Статус" value={filters.status ?? ''} options={options.statuses} onChange={patch('status')} />
        {Object.keys(filters).length > 0 && (
          <button type="button" className="ugra-btn ugra-btn--ghost ugra-btn--sm rd-reset" onClick={() => setFilters({})}>
            Сбросить
          </button>
        )}
        <span className="rd-filters__spacer" />
        {rangeBroken && <span className="rd-status rd-status--warn">Конец раньше начала — показываем пресет</span>}
        {loading && <span className="rd-status">обновляем…</span>}
        {error && <span className="rd-status rd-status--error">{error}</span>}
      </div>

      <TilesWidget days={days} filters={filters} overview={data ?? undefined} fetchOwn={false} />
      <MainWidget days={days} filters={filters} overview={data ?? undefined} fetchOwn={false} />

      <p className="rd-source-note">
        Заявки и события — синтетическая история за 6 месяцев (модуль `history-seed`). Выгрузка в
        Excel, PDF и CSV, отправка на почту и еженедельная сводка появятся вместе с отчётами О1–О8.
      </p>
    </div>
  );
}
