import './measure.css';
import type { TicketListResponse, TicketResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Toast,
  formatElapsed,
  useActionCounter,
  useElapsed,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { AiCard } from './AiCard';
import { ManualForm } from './ManualForm';
import { SummaryPanel } from './SummaryPanel';
import type { MeasureMode, MeasureSession } from './format';
import {
  MAX_SESSIONS,
  aiFieldRows,
  demoSessions,
  pickMeasureFields,
  summarizeSessions,
} from './format';
import {
  clearSessions,
  downloadJson,
  exportFileName,
  exportPayload,
  loadSessions,
  saveSessions,
} from './storage';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionId(mode: MeasureMode, startedAt: number): string {
  return `${mode}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Замер К4 «с ИИ / без ИИ»: две колонки на одной и той же заявке.
 * Действия считает `useActionCounter`, время — от старта до «Готово».
 * Сессии живут в localStorage (❓ серверной таблицы у модуля пока нет).
 */
export function MeasurePage({ meta, api, query, user }: WebPageProps): JSX.Element {
  const demoQuery = query.get('demo') === '1';
  const ticketId = query.get('ticket');

  const [sessions, setSessions] = useState<MeasureSession[]>(() =>
    demoQuery ? demoSessions() : loadSessions(),
  );
  const [mode, setMode] = useState<MeasureMode | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const actions = useActionCounter();
  const resetActions = actions.reset;
  const elapsed = useElapsed(startedAt);

  // Стартовый клик документный счётчик ловит раньше, чем React сбрасывает состояние,
  // поэтому обнуляем после рендера: клик по «Начать замер» в цифры не попадает.
  useEffect(() => {
    if (mode === null) return;
    resetActions();
  }, [mode, resetActions]);

  const fields = useMemo(() => pickMeasureFields(meta.fields), [meta.fields]);
  const rows = useMemo(
    () => (ticket ? aiFieldRows(meta.fields, meta.dictionaries, ticket.fields) : []),
    [meta.dictionaries, meta.fields, ticket],
  );
  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);
  const manualSessions = sessions.filter((session) => session.mode === 'manual').length;
  const aiSessions = sessions.filter((session) => session.mode === 'ai').length;
  const filled = fields.filter((field) => (values[field.key] ?? '').trim() !== '').length;

  const loadTicket = useCallback(async (): Promise<void> => {
    setTicketLoading(true);
    setTicketError(null);
    try {
      let id = ticketId;
      if (!id) {
        const list = await api.get<TicketListResponse>('/api/tickets?limit=1');
        id = list.tickets[0]?.id ?? null;
      }
      if (!id) {
        setTicketError('В очереди нет заявок. Создайте обращение или откройте ?demo=1.');
        return;
      }
      setTicket(await api.get<TicketResponse>(`/api/tickets/${id}`));
    } catch (cause) {
      setTicketError(errorText(cause));
    } finally {
      setTicketLoading(false);
    }
  }, [api, ticketId]);

  const start = (kind: MeasureMode): void => {
    if (mode !== null) return;
    setValues({});
    setTicket(null);
    setTicketError(null);
    setToast(null);
    setMode(kind);
    setStartedAt(Date.now());
    if (kind === 'ai') void loadTicket();
  };

  const cancel = (): void => {
    if (mode === null) return;
    setMode(null);
    setStartedAt(null);
    setValues({});
    setTicket(null);
    actions.reset();
    setToast('Замер отменён — ничего не сохранено');
  };

  const finish = (kind: MeasureMode): void => {
    if (mode !== kind || startedAt === null) return;
    const seconds = Math.max(0, (Date.now() - startedAt) / 1000);
    const session: MeasureSession = {
      id: sessionId(kind, startedAt),
      mode: kind,
      // Финальный клик по «Готово» документный слушатель ещё не успел положить в состояние.
      actions: actions.count + 1,
      seconds: Math.round(seconds * 10) / 10,
      fields: kind === 'manual' ? filled : rows.length,
      createdAt: new Date().toISOString(),
      demo: demoQuery || undefined,
    };
    const next = [session, ...sessions].slice(0, MAX_SESSIONS);
    const saved = demoQuery ? true : saveSessions(next.filter((entry) => entry.demo !== true));
    setSessions(next);
    setMode(null);
    setStartedAt(null);
    setValues({});
    setTicket(null);
    actions.reset();
    setToast(
      saved
        ? `Замер сохранён: ${session.actions} действий`
        : `Замер учтён, но браузер не дал сохранить. Экспортируйте JSON.`,
    );
  };

  const resetAll = (): void => {
    if (sessions.length > 0 && typeof window !== 'undefined' && !window.confirm('Удалить сохранённые замеры?')) {
      return;
    }
    clearSessions();
    setSessions([]);
    setMode(null);
    setStartedAt(null);
    setValues({});
    setTicket(null);
    actions.reset();
    setToast('Замеры сброшены');
  };

  const exportJson = (): void => {
    if (sessions.length === 0) {
      setToast('Пока нечего экспортировать: сделайте хотя бы один замер');
      return;
    }
    const text = exportPayload(sessions, summary);
    const ok = downloadJson(text, exportFileName());
    setToast(ok ? 'JSON для слайда скачан' : 'Браузер не дал скачать файл');
  };

  const busy = mode !== null;
  const liveActions = actions.count;
  const demo = demoQuery || summary.demo;

  return (
    <div className="measure-page">
      <header className="measure-head" data-reveal>
        <div>
          <span className="measure-eyebrow">Критерий К4 · {user.role === 'admin' ? 'админ' : 'диспетчер'}</span>
          <h1 className="measure-title">С ИИ / без ИИ</h1>
          <p className="measure-lead">Одна заявка дважды: вручную и с ИИ. Система считает действия и время.</p>
        </div>
        <div className="measure-head__actions">
          {demo && <Badge tone="warn">демо-данные</Badge>}
          <span className="measure-hint">
            Замеров: {manualSessions} вручную · {aiSessions} с ИИ
          </span>
          <Button variant="secondary" size="sm" onClick={exportJson}>
            Экспорт JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={resetAll}>
            Сбросить
          </Button>
        </div>
      </header>

      <Card className="measure-live">
        <div className="measure-live__item">
          <span className="measure-live__label">Режим</span>
          <span className="measure-live__value">
            {mode === 'manual' ? 'вручную' : mode === 'ai' ? 'с ИИ' : 'не запущен'}
          </span>
        </div>
        <div className="measure-live__item">
          <span className="measure-live__label">Действий</span>
          <span className="measure-live__value measure-live__value--num">{liveActions}</span>
        </div>
        <div className="measure-live__item">
          <span className="measure-live__label">Время</span>
          <span className="measure-live__value measure-live__value--num">
            {mode !== null ? formatElapsed(elapsed) : '0:00'}
          </span>
        </div>
        <div className="measure-live__item measure-live__item--hint">
          <span className="measure-hint">
            {busy
              ? 'Идёт замер: счётчик ловит клики, ввод, выбор и переходы, таймер остановится на «Готово».'
              : 'Начните замер в любой колонке. Две колонки — одна и та же заявка.'}
          </span>
        </div>
      </Card>

      <div className="measure-columns">
        <ManualForm
          fields={fields}
          values={values}
          active={mode === 'manual'}
          busy={busy && mode !== 'manual'}
          dictionaries={meta.dictionaries}
          onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
          onStart={() => start('manual')}
          onFinish={() => finish('manual')}
          onCancel={cancel}
        />

        <AiCard
          active={mode === 'ai'}
          busy={busy && mode !== 'ai'}
          loading={ticketLoading}
          error={ticketError}
          ticket={ticket}
          rows={rows}
          onStart={() => start('ai')}
          onFinish={() => finish('ai')}
          onCancel={cancel}
          onRetry={() => void loadTicket()}
        />
      </div>

      <SummaryPanel summary={summary} demoQuery={demoQuery} />

      <Toast message={toast} tone="info" onClose={() => setToast(null)} />
    </div>
  );
}
