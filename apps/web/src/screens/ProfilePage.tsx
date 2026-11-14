import './profile.css';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse, ProfileResponse, User } from '@ugra/contracts';
import { Button, Icon, PersonAvatar } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { departmentLabel, equipmentLine, placeLabel } from './profile-format';

interface ProfilePageProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
  onLogout: () => void;
}

/**
 * Экран 04 «Профиль»: кто вошёл, подразделение, рабочее место и техника из учёта.
 * Данные — один запрос `GET /api/profile`; смена пользователя — `POST /api/logout`.
 * Место и техника показываются только из ответа API: пусто — так и написано.
 */
export function ProfilePage({ user, meta, api, onLogout }: ProfilePageProps): JSX.Element {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; profile: ProfileResponse }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .get<ProfileResponse>('/api/profile')
      .then((profile) => {
        if (alive) setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (alive)
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const profile = state.status === 'ready' ? state.profile.profile : null;
  const equipment = state.status === 'ready' ? state.profile.equipment : [];
  const place = placeLabel(profile);
  const subtitle = user.departmentId
    ? `${user.position} · ${departmentLabel(meta, user.departmentId)}`
    : user.position;

  return (
    <div className="profile-page">
      <section className="ugra-card profile-hero" data-reveal>
        <PersonAvatar name={user.fullName} size={88} />
        <div className="profile-hero__text">
          <h1 className="profile-hero__name">{user.fullName}</h1>
          <p className="profile-hero__role">{subtitle}</p>
        </div>
        <Button variant="secondary" className="profile-logout" onClick={onLogout}>
          Сменить пользователя
        </Button>
      </section>

      {state.status === 'loading' && (
        <p className="profile-note" role="status">
          Загружаем профиль…
        </p>
      )}

      {state.status === 'error' && (
        <p className="profile-note profile-error" role="alert">
          Не удалось загрузить профиль: {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <div className="profile-grid">
          <section className="ugra-card profile-card" data-reveal>
            <h2 className="profile-card__cap">Где вы сидите</h2>
            <p className="profile-place">{place ?? 'Место не указано'}</p>
            <p className="profile-hint">
              {user.role === 'applicant'
                ? 'Помощник подставит это место, если вы его не назовёте.'
                : 'Место и технику можно уточнить в обращении.'}
            </p>
          </section>

          <section className="ugra-card profile-card" data-reveal>
            <h2 className="profile-card__cap">Ваша техника</h2>
            {equipment.length > 0 ? (
              <ul className="profile-equipment">
                {equipment.map((item) => (
                  <li className="profile-device" key={item.id}>
                    <span className="profile-device__icon" aria-hidden="true">
                      <Icon name="queue" size={22} />
                    </span>
                    <span className="profile-device__text">
                      <strong className="profile-device__name">{equipmentLine(item)}</strong>
                      {item.note && <span className="profile-device__note">{item.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="profile-hint">Техника в профиле не указана</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
