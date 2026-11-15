import type { JSX } from 'react';
import { Card } from '@ugra/ui';
import type { SimilarGroup } from './format';
import { capitalizeFirst, pluralRu } from './format';

interface TaskFoldsProps {
  groups: readonly SimilarGroup[];
  /** Сколько из них уже решено: остальные ещё в работе. */
  solved: number;
  /** Сколько похожих заявок относится к той же технике: 0–1 — не показываем. */
  recurring: number;
}

/** Подвал задачи: похожие заявки одной строкой на формулировку и частая техника. */
export function TaskFolds({ groups, solved, recurring }: TaskFoldsProps): JSX.Element {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const solvedLabel =
    solved === 0
      ? 'все ещё в работе — решённых пока нет'
      : `${solved} ${pluralRu(solved, 'решена', 'решены', 'решено')} из ${total}`;

  return (
    <div className="ed-folds">
      <Card className="ed-fold">
        <h2 className="ed-fold__title">
          Похожие заявки{total > 0 ? ` · ${total}` : ''}
        </h2>
        <p className="ed-fold__sub">
          {total > 0 ? solvedLabel : 'Пока никто не сталкивался — вы первый'}
        </p>

        {groups.length > 0 && (
          <ul className="ed-fold__list">
            {groups.slice(0, 4).map((group) => (
              <li key={group.title} className="ed-fold__row">
                <span className="ed-fold__row-title">{capitalizeFirst(group.title)}</span>
                <span className="ed-fold__count">
                  {group.count} {pluralRu(group.count, 'заявка', 'заявки', 'заявок')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {recurring > 1 && (
        <Card className="ed-fold ed-fold--narrow">
          <p className="ed-fold__big">{recurring}×</p>
          <div>
            <h2 className="ed-fold__title">По этой технике</h2>
            <p className="ed-fold__sub">столько заявок с той же моделью уже было — стоит проверить замену.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
