import type { JSX } from 'react';
import { Checklist, ProgressScale } from '@ugra/ui';
import { clockFromMs } from './incident-view';

export interface RegulationBlockProps {
  /** Шаги регламента из `data/emergency-rules.json` (через разбор ИИ). */
  checklist: readonly string[];
  /** Время отметки шага (мс) или `null`, если шаг не отмечен. */
  checks: readonly (number | null)[];
  onToggle: (index: number) => void;
  loading: boolean;
}

/**
 * Тело свёрнутого блока «Регламент»: шкала этапов и чек-лист с отметками.
 * Пока идёт разбор — одна строка; шагов нет — тоже одна строка, а не вечная загрузка.
 */
export function RegulationBlock({ checklist, checks, onToggle, loading }: RegulationBlockProps): JSX.Element {
  const doneCount = checks.filter((value) => value !== null && value !== undefined).length;

  if (checklist.length === 0) {
    return (
      <p className="er-note">
        {loading ? 'Загружаем регламент…' : 'Регламент не задан — действуйте по инструкции дежурного.'}
      </p>
    );
  }

  const items = checklist.map((step, index) => {
    const markedAt = checks[index] ?? null;
    return {
      id: String(index),
      label: step,
      hint: clockFromMs(markedAt),
      done: markedAt !== null,
    };
  });

  return (
    <div className="er-steps">
      <ProgressScale
        stage={doneCount}
        labels={checklist.map((_, index) => String(index + 1))}
        className="er-steps__scale"
      />
      <Checklist items={items} onToggle={(id) => onToggle(Number(id))} label="Шаги регламента" />
    </div>
  );
}
