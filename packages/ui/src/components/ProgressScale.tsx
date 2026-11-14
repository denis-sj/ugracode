import type { JSX } from 'react';
import { cx } from '../cx';
import { TICKET_STAGES, stageSegments } from '../ticket-format';

export interface ProgressScaleProps {
  /** Сколько сегментов закрашено (0…N). */
  stage: number;
  labels?: readonly string[];
  showLabels?: boolean;
  className?: string;
}

/**
 * Шкала этапов «Собрана → Проверена → Назначена → Выполнена» (4.1):
 * четыре сегмента, закрашенные плавно; подписи — по желанию (стикер, «Мои заявки»).
 */
export function ProgressScale({
  stage,
  labels = TICKET_STAGES,
  showLabels = false,
  className,
}: ProgressScaleProps): JSX.Element {
  const segments = stageSegments(stage, labels.length);
  const filled = segments.filter(Boolean).length;
  const reached = filled > 0 ? labels[filled - 1] : undefined;
  const summary = reached ? `Этап ${filled} из ${labels.length}: ${reached}` : `Этап 0 из ${labels.length}`;

  return (
    <div className={cx('ugra-scale', className)} role="img" aria-label={summary}>
      <div className="ugra-scale__bars" aria-hidden="true">
        {segments.map((on, index) => (
          <span key={index} className={cx('ugra-scale__seg', on && 'ugra-scale__seg--on')} />
        ))}
      </div>
      {showLabels && (
        <div className="ugra-scale__labels" aria-hidden="true">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
