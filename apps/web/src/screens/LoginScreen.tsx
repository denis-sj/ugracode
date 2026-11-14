import type { MetaResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card } from '@ugra/ui';
import { api, ApiError } from '../api';
import { groupUsersByRole, initials, ROLE_HINTS } from '../lib';
import { useSession } from '../session';

function UserCard({ user, index, disabled }: { user: User; index: number; disabled: boolean }): JSX.Element {
  const { signIn } = useSession();
  return (
    <button
      type="button"
      className="login-user ugra-rise"
      style={{ animationDelay: `calc(var(--dur-fast) * ${index} / 2)` }}
      onClick={() => void signIn(user.id)}
      disabled={disabled}
    >
      <span className="login-user__avatar" aria-hidden="true">
        {initials(user.fullName)}
      </span>
      <span className="login-user__body">
        <span className="login-user__name">{user.fullName}</span>
        <span className="login-user__position">{user.position}</span>
        <span className="login-user__hint">{ROLE_HINTS[user.role]}</span>
      </span>
      <span className="login-user__arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

/** Экран входа: выбор готового пользователя из сид-данных + режим «гость». */
export function LoginScreen({ meta }: { meta: MetaResponse }): JSX.Element {
  const { pending, error, signIn } = useSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .users()
      .then((list) => {
        if (alive) setUsers(list);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setLoadError(cause instanceof ApiError ? cause.message : 'Не удалось загрузить пользователей');
      });
    return () => {
      alive = false;
    };
  }, []);

  const retry = (): void => {
    setLoadError(null);
    setUsers(null);
    api
      .users()
      .then(setUsers)
      .catch((cause: unknown) =>
        setLoadError(cause instanceof ApiError ? cause.message : 'Не удалось загрузить пользователей'),
      );
  };

  const groups = users ? groupUsersByRole(users) : [];
  let cardIndex = 0;

  return (
    <div className="login">
      <div className="login__glow login__glow--one" aria-hidden="true" />
      <div className="login__glow login__glow--two" aria-hidden="true" />

      <div className="login__inner">
        <section className="login__hero ugra-rise">
          <span className="login__kicker">Газпром трансгаз Сургут · кейс 9</span>
          <h1 className="login__title">
            Диспетчерская,
            <br />
            которая думает
            <br />
            <span className="login__title-accent">вместе с вами</span>
          </h1>
          <p className="login__lead">
            Опишите проблему словами — ИИ соберёт заявку, задаст уточняющие вопросы и покажет диспетчеру, откуда взято
            каждое поле.
          </p>

          <ul className="login__features">
            <li>Живой разбор обращения на глазах</li>
            <li>Каждое поле — с цитатой и уверенностью</li>
            <li>Авария и массовость — сразу в приоритете</li>
          </ul>

          <div className="login__status">
            <Badge tone="accent">ИИ предлагает — человек подтверждает</Badge>
            <Badge tone="neutral">{meta.modules.length} модулей</Badge>
            <Badge tone="neutral">{meta.fields.length} полей в реестре</Badge>
          </div>
        </section>

        <Card className="login__panel ugra-rise" glass hero>
          <header className="login__panel-head">
            <div>
              <h2>Вход в систему</h2>
              <p className="ugra-muted">Выберите, кто вы — права выдаёт сервер.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void signIn('guest')} disabled={pending}>
              Войти как гость
            </Button>
          </header>

          {error && <p className="login__error">{error}</p>}

          {!users && !loadError && (
            <div className="login__loading">
              <span className="ugra-btn__spinner" aria-hidden="true" />
              Загружаем пользователей…
            </div>
          )}

          {loadError && (
            <div className="login__load-error">
              <strong>API не отвечает</strong>
              <p className="ugra-muted">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={retry}>
                Обновить
              </Button>
            </div>
          )}

          {users && users.length === 0 && <p className="ugra-muted">На сервере нет пользователей. Выполните `pnpm seed`.</p>}

          <div className="login__groups">
            {groups.map((group) => (
              <section className="login__group" key={group.role}>
                <h3 className="login__group-title">
                  {group.label}
                  <span className="login__group-count">{group.users.length}</span>
                </h3>
                <div className="login__group-cards">
                  {group.users.map((user) => {
                    const index = cardIndex;
                    cardIndex += 1;
                    return <UserCard key={user.id} user={user} index={index} disabled={pending} />;
                  })}
                </div>
              </section>
            ))}
          </div>

          {pending && (
            <div className="login__pending" role="status">
              <span className="ugra-btn__spinner" aria-hidden="true" />
              Входим…
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
