import type { JSX } from 'react';
import type { Role, User } from '@ugra/contracts';
import { initials, roleLabel } from './shell/lib';

const GROUP_ORDER: readonly Role[] = ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'];

export interface LoginScreenProps {
  users: readonly User[];
  busyUserId: string | null;
  error: string | null;
  usersError: boolean;
  onLogin: (userId: string) => void;
  onRetry: () => void;
}

function groupUsers(users: readonly User[]): Array<{ role: Role; users: User[] }> {
  return GROUP_ORDER.map((role) => ({ role, users: users.filter((user) => user.role === role) })).filter(
    (group) => group.users.length > 0,
  );
}

/**
 * Вход выбором готового пользователя. Экран не нарисован в макетах (❓ состав профиля),
 * поэтому повторяет общий светлый стиль: стекло, графит, инициалы.
 */
export function LoginScreen({
  users,
  busyUserId,
  error,
  usersError,
  onLogin,
  onRetry,
}: LoginScreenProps): JSX.Element {
  const groups = groupUsers(users);

  return (
    <main className="login-page">
      <section className="login-hero">
        <span className="login-brand">Диспетчерская</span>
        <h1 className="login-title">Обращения, которые разбирает ИИ</h1>
        <p className="login-lead">
          Выберите, кем войти. Диспетчер видит очередь и проверяет заявки, заявитель — обращение и свои
          заявки, инженер — задачи, руководитель — отчёты.
        </p>
      </section>

      <section className="login-panel ugra-card" aria-label="Выбор пользователя">
        <div className="login-panel__head">
          <h2>Вход</h2>
          <p className="ugra-muted">Готовые пользователи из демо-данных</p>
        </div>

        {usersError && (
          <div className="login-error" role="alert">
            <p>Не удалось загрузить пользователей.</p>
            <button type="button" className="ugra-btn ugra-btn--secondary ugra-btn--sm" onClick={onRetry}>
              Повторить
            </button>
          </div>
        )}

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        {groups.length === 0 && !usersError && <p className="ugra-muted">Пользователей нет</p>}

        <div className="login-groups">
          {groups.map((group) => (
            <div className="login-group" key={group.role}>
              <div className="login-group__title">
                {roleLabel(group.role)}
                <span className="login-group__count">{group.users.length}</span>
              </div>
              <div className="login-group__list">
                {group.users.map((user) => (
                  <button
                    type="button"
                    className="login-user"
                    key={user.id}
                    onClick={() => onLogin(user.id)}
                    disabled={busyUserId !== null}
                  >
                    <span className="login-user__avatar" aria-hidden="true">
                      {initials(user.fullName)}
                    </span>
                    <span className="login-user__body">
                      <span className="login-user__name">{user.fullName}</span>
                      <span className="login-user__position">{user.position}</span>
                    </span>
                    <span className="login-user__arrow" aria-hidden="true">
                      {busyUserId === user.id ? '…' : '→'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
