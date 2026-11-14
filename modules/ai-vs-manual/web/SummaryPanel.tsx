import type { JSX } from 'react';
import { Badge, Card, StatTile } from '@ugra/ui';
import type { MeasureSummary } from './format';
import { formatSeconds } from './format';
import { MANUAL_ACTION_DEFINITION } from './storage';

export interface SummaryPanelProps {
  summary: MeasureSummary;
  /** В адресе `?demo=1` — цифры предзаполнены для показа. */
  demoQuery: boolean;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function percentText(value: number): string {
  return `${value} %`;
}

/** Итог «N против M действий, X против Y секунд» + определение ручного действия. */
export function SummaryPanel({ summary, demoQuery }: SummaryPanelProps): JSX.Element {
  const { manual, ai } = summary;
  const demo = demoQuery || summary.demo;
  const actionsPhrase = `${manual.actions} против ${ai.actions} ${plural(ai.actions, 'действия', 'действий', 'действий')}`;  const timePhrase = `${formatSeconds(manual.seconds)} против ${formatSeconds(ai.seconds)}`;
  const faster = summary.speedup > 1 ? `в ${String(summary.speedup).replace('.', ',')} раза быстрее` : null;
  const slower = summary.actionsSaved < 0;

  return (
    <Card className="measure-summary" hero>
      <header className="measure-summary__head">
        <div>
          <span className="measure-eyebrow">Итог замера · критерий К4</span>
          <h2>Одна заявка в двух режимах</h2>
        </div>
        {demo && <Badge tone="warn">демо-данные</Badge>}
      </header>

      {!summary.ready ? (
        <p className="measure-summary__empty">
          Сделайте по одному замеру в каждой колонке — итог появится здесь сам. Сохранено:{' '}
          {manual.sessions} ручных и {ai.sessions} с ИИ.
        </p>
      ) : (
        <>
          <p className="measure-summary__phrase" aria-live="polite">
            <b>{actionsPhrase}</b>, <b>{timePhrase}</b>
            {faster && !slower && <span className="measure-summary__speed"> · {faster}</span>}
          </p>

          <div className="measure-summary__tiles">
            <StatTile
              label="Действия вручную"
              value={manual.actions}
              hint={`среднее за ${manual.sessions} ${plural(manual.sessions, 'замер', 'замера', 'замеров')}`}
              tone="warn"
            />
            <StatTile
              label="Действия с ИИ"
              value={ai.actions}
              hint={`среднее за ${ai.sessions} ${plural(ai.sessions, 'замер', 'замера', 'замеров')}`}
              tone="ok"
            />
            <StatTile label="Время вручную" value={formatSeconds(manual.seconds)} hint="от старта до «Готово»" />
            <StatTile label="Время с ИИ" value={formatSeconds(ai.seconds)} hint="от старта до «Готово»" tone="ok" />
          </div>

          <div className="measure-summary__percent">
            <span className={summary.actionsPercent < 0 ? 'measure-summary__bad' : 'measure-summary__good'}>
              {slower ? 'ИИ потребовал больше действий: ' : 'Экономия действий: '}
              {percentText(summary.actionsPercent)}
            </span>
            <span className={summary.timePercent < 0 ? 'measure-summary__bad' : 'measure-summary__good'}>
              Экономия времени: {percentText(summary.timePercent)}
            </span>
            {summary.actionsSaved > 0 && summary.secondsSaved > 0 && (
              <span className="ugra-dim">
                на {summary.actionsSaved} действий меньше, на {formatSeconds(summary.secondsSaved)} быстрее
              </span>
            )}
          </div>
        </>
      )}

      <p className="measure-legend">
        <b>Что считаем действием. </b>
        {MANUAL_ACTION_DEFINITION}
      </p>
    </Card>
  );
}
