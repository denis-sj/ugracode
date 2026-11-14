import type { ChangeEvent, CSSProperties, JSX } from 'react';
import { useState } from 'react';
import type { OverviewResult } from '../contracts';
import type { OverviewFiltersState, OverviewQuery } from './api';
import { formatDateRange } from './format';
import { MainWidget } from './MainWidget';
import { SectionTitle, TilesWidget } from './TilesWidget';
import { useOverview } from './useOverview';

/** Страница `/dashboard`: период, фильтры, выгрузка, плитки и основной блок. */

const PERIODS: readonly { days: number; label: string }[] = [
  { days: 1, label: 'Смена' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: 'Квартал' },
];

const CHANNELS: readonly { value: string; label: string }[] = [
  { value: 'chat', label: 'Чат' },
  { value: 'phone', label: 'Телефон' },
  { value: 'email', label: 'Почта' },
  { value: 'screenshot', label: 'Скриншот' },
];

const STATUSES: readonly { value: string; label: string }[] = [
  { value: 'new', label: 'Новая' },
  { value: 'in_review', label: 'На проверке' },
  { value: 'assigned', label: 'Назначена' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решена' },
  { value: 'closed', label: 'Закрыта' },
  { value: 'cancelled', label: 'Отменена' },
];

const EXPORTS: readonly { label: string; hint: string }[] = [
  { label: 'Excel (.xlsx)', hint: 'все разрезы, по листам' },
  { label: 'PDF-отчёт', hint: 'с выводами, для печати' },
  { label: 'CSV', hint: 'сырые заявки периода' },
  { label: 'Отправить на почту', hint: 'сейчас' },
  { label: 'Присылать сводку', hint: 'каждый понедельник' },
];

const control: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-pill)',
  padding: '7px 12px',
};

const segBase: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 14px',
  cursor: 'pointer',
};

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}:</span>
      <select
        style={control}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
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

function filterOptions(data: OverviewResult | null): {
  categories: { value: string; label: string }[];
  buildings: { value: string; label: string }[];
  assignees: { value: string; label: string }[];
} {
  if (!data) return { categories: [], buildings: [], assignees: [] };
  return {
    categories: data.byCategory.map((slice) => ({ value: slice.key, label: slice.label })),
    buildings: data.byBuilding.map((slice) => ({ value: slice.key, label: slice.label })),
    assignees: data.byAssignee.map((slice) => ({ value: slice.key, label: slice.label })),
  };
}

function periodTitle(days: number, from: string, to: string): string {
  if (from && to) return formatDateRange(from, to);
  if (days === 1) return 'смену';
  if (days === 90) return 'квартал';
  return `${days} дней`;
}

/** Дашборд руководителя: один запрос к маршруту отчёта, виджеты получают готовые данные. */
export function DashboardPage(): JSX.Element {
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<OverviewFiltersState>({});
  const [exportOpen, setExportOpen] = useState(false);

  const customRange = from !== '' && to !== '';
  const query: OverviewQuery = {
    ...(customRange ? { from, to } : { days }),
    ...filters,
  };
  const { data, loading, error } = useOverview(query);
  const options = filterOptions(data);

  const patch = (key: keyof OverviewFiltersState) => (value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: '-0.04em' }}>
            Обращения за {periodTitle(days, customRange ? from : '', customRange ? to : '')}
          </h1>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Сравнение с прошлым таким же периодом
            {data ? `: ${formatDateRange(data.previousPeriod.from, data.previousPeriod.to)}` : ''}. Клик по цифре
            открывает очередь заявок.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            role="group"
            aria-label="Период"
            style={{
              display: 'flex',
              gap: 2,
              padding: 3,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            {PERIODS.map((period) => {
              const active = !customRange && days === period.days;
              return (
                <button
                  key={period.days}
                  type="button"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                    setDays(period.days);
                  }}
                  style={{
                    ...segBase,
                    color: active ? 'var(--color-text)' : segBase.color,
                    background: active ? 'var(--color-bg-soft)' : 'transparent',
                  }}
                  aria-pressed={active}
                >
                  {period.label}
                </button>
              );
            })}
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Даты:</span>
            <input
              type="date"
              value={from}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)}
              style={control}
              aria-label="Дата начала"
            />
            <input
              type="date"
              value={to}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTo(event.target.value)}
              style={control}
              aria-label="Дата конца"
            />
          </label>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="ugra-button"
              onClick={() => setExportOpen((open) => !open)}
              aria-expanded={exportOpen}
              style={{
                ...control,
                background: 'var(--color-text)',
                color: 'var(--color-bg)',
                cursor: 'pointer',
              }}
            >
              Выгрузить ▾
            </button>
            {exportOpen && (
              <div
                className="ugra-card"
                role="menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 44,
                  zIndex: 8,
                  width: 300,
                  padding: 6,
                  background: 'var(--color-surface)',
                }}
              >
                {EXPORTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled
                    title="Серверный маршрут выгрузки появится вместе с отчётами О1–О8"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 16,
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      font: 'inherit',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--color-text-dim)',
                      cursor: 'not-allowed',
                    }}
                  >
                    {item.label}
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{item.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <section style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-dim)', marginRight: 4 }}>Фильтры</span>
        <Select label="Категория" value={filters.category ?? ''} options={options.categories} onChange={patch('category')} />
        <Select label="Исполнитель" value={filters.assigneeId ?? ''} options={options.assignees} onChange={patch('assigneeId')} />
        <Select label="Канал" value={filters.channel ?? ''} options={CHANNELS} onChange={patch('channel')} />
        <Select label="Корпус" value={filters.building ?? ''} options={options.buildings} onChange={patch('building')} />
        <Select label="Статус" value={filters.status ?? ''} options={STATUSES} onChange={patch('status')} />
        {loading && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>обновляем…</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>{error}</span>}
      </section>

      <TilesWidget days={days} filters={filters} overview={data ?? undefined} fetchOwn={false} />
      <MainWidget days={days} filters={filters} overview={data ?? undefined} fetchOwn={false} />

      <SectionTitle>Источник данных</SectionTitle>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-dim)' }}>
        Заявки и события — синтетическая история за 6 месяцев (модуль `history-seed`). Выгрузка в Excel, PDF и CSV,
        отправка на почту и еженедельная сводка требуют серверных маршрутов выгрузки — пункты меню пока выключены.
      </p>
    </div>
  );
}
