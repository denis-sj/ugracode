import { useId, useState } from 'react';
import type { JSX } from 'react';
import type { Role, User } from '@ugra/contracts';
import { Icon, PersonAvatar } from '@ugra/ui';
import { FALLBACK_GUEST_ID, GUEST_USER_ID } from '../../../modules/voice-call/web/call-flow';
import { LOGIN_ROLES, pickRoleUser, roleLabel } from './shell/lib';

/** Учётки для «Ещё»: общий гость без профиля и звонок ИИ-оператору (страница `/call`). */
const DEMO_ACCOUNT_IDS: readonly string[] = [FALLBACK_GUEST_ID, GUEST_USER_ID];

export interface LoginScreenProps {
  users: readonly User[];
  busyUserId: string | null;
  error: string | null;
  usersError: boolean;
  onLogin: (userId: string) => void;
  onRetry: () => void;
}

/** Готовые учётки демо, которые не попали на карточки ролей. */
function demoAccounts(users: readonly User[]): User[] {
  return DEMO_ACCOUNT_IDS.map((id) => users.find((user) => user.id === id)).filter(
    (user): user is User => user !== undefined,
  );
}

interface RoleCard {
  role: Role;
  user: User;
}

/**
 * Вход по роли: четыре крупные карточки — по одной готовой учётке на роль, клик входит сразу.
 * Остальные учётки (гость, звонок ИИ-оператору) спрятаны в «Ещё», администратор — малой ссылкой.
 * Полный список людей здесь не показываем: инженеры нужны подбору исполнителя, а не экрану входа.
 */
export function LoginScreen({
  users,
  busyUserId,
  error,
  usersError,
  onLogin,
  onRetry,
}: LoginScreenProps): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const busy = busyUserId !== null;

  const cards = LOGIN_ROLES.flatMap((role): RoleCard[] => {
    const user = pickRoleUser(users, role);
    return user === null ? [] : [{ role, user }];
  });
  const admin = users.find((user) => user.role === 'admin');
  const extras = demoAccounts(users);

  return (
    <main className="login-page">
      <section className="login-hero">
        <span className="login-brand">Диспетчерская</span>
        <h1 className="login-title">Обращения, которые разбирает ИИ</h1>
        <p className="login-lead">Выберите роль — учётка уже готова, пароль не нужен.</p>

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

        {cards.length === 0 && !usersError && <p className="ugra-muted">Пользователей нет</p>}
      </section>

      {cards.length > 0 && (
        <section className="login-roles" aria-label="Вход по роли">
          {cards.map(({ role, user }) => (
            <button
              type="button"
              className="login-role"
              key={role}
              data-reveal
              onClick={() => onLogin(user.id)}
              disabled={busy}
              aria-busy={busyUserId === user.id}
            >
              <span className="login-role__top">
                <PersonAvatar name={user.fullName} size={56} />
                <span className="login-role__badge">{roleLabel(role)}</span>
              </span>
              <span className="login-role__text">
                <span className="login-role__name">{user.fullName}</span>
                <span className="login-role__position">{user.position}</span>
              </span>
              <span className="login-role__arrow" aria-hidden="true">
                {busyUserId === user.id ? '…' : '→'}
              </span>
            </button>
          ))}
        </section>
      )}

      <section className="login-more" aria-label="Дополнительно">
        <div className="login-more__row">
          {admin ? (
            <button
              type="button"
              className="login-more__link"
              title={`Войти как администратор: ${admin.fullName}`}
              onClick={() => onLogin(admin.id)}
              disabled={busy}
            >
              Администратор
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="login-more__toggle"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((open) => !open)}
          >
            Ещё
            <span className="login-more__chevron" aria-hidden="true" />
          </button>
        </div>

        {moreOpen && (
          <div className="login-more__panel" id={moreId} data-reveal>
            {extras.map((user) => (
              <button
                type="button"
                className="login-extra"
                key={user.id}
                onClick={() => onLogin(user.id)}
                disabled={busy}
              >
                <PersonAvatar name={user.fullName} size={36} />
                <span className="login-extra__body">
                  <span className="login-extra__name">{user.fullName}</span>
                  <span className="login-extra__position">{user.position}</span>
                </span>
                <span className="login-extra__arrow" aria-hidden="true">
                  {busyUserId === user.id ? '…' : '→'}
                </span>
              </button>
            ))}

            <a className="login-extra login-extra--call" href="/call">
              <span className="login-extra__icon" aria-hidden="true">
                <Icon name="phone" size={18} />
              </span>
              <span className="login-extra__body">
                <span className="login-extra__name">Страница звонка</span>
                <span className="login-extra__position">Сценарий по QR: /call</span>
              </span>
              <span className="login-extra__arrow" aria-hidden="true">
                →
              </span>
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
