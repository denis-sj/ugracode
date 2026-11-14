import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse, ProfileResponse, User } from '@ugra/contracts';
import { PersonAvatar } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { departmentLabel, equipmentLine, placeLabel } from './profile-format';

interface ProfilePageProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
  onLogout: () => void;
}

/**
 * Профиль: кто вошёл, подразделение, рабочее место заявителя и техника из профиля.
 * Данные — `GET /api/profile`; смена пользователя — `POST /api/logout`.
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

  return (
    <div className="profile-page">
      <section className="profile-hero ugra-card" data-reveal>
        <PersonAvatar name={user.fullName} size={88} />
        <div className="profile-hero__text">
          <h1>{user.fullName}</h1>
          <p className="ugra-muted">
            {user.position} · {departmentLabel(meta, user.departmentId)}
          </p>
        </div>
        <button type="button" className="ugra-btn ugra-btn--secondary profile-switch" onClick={onLogout}>
          Сменить пользователя
        </button>
      </section>
      <div className="profile-grid">
        <section className="ugra-card profile-card" data-reveal>
          <h2>Где вы сидите</h2>
          {state.status === 'loading' && (
            <p className="ugra-muted" role="status">
              Загружаем профиль…
            </p>
          )}
          {state.status === 'error' && <p role="alert">Не удалось загрузить профиль: {state.message}</p>}
          {state.status === 'ready' && (
            <>
              <p className="profile-place">{place ?? 'Место не указано'}</p>
              <p className="ugra-muted">
                {user.role === 'applicant'
                  ? 'Помощник подставит это место, если вы его не назовёте.'
                  : 'Место и технику можно уточнить в обращении.'}
              </p>
            </>
          )}
        </section>
        <section className="ugra-card profile-card" data-reveal>
          <h2>Ваша техника</h2>
          {equipment.length > 0 ? (
            <ul className="profile-equipment">
              {equipment.map((item) => (
                <li key={item.id}>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="13" rx="2" />
                    <path d="M12 16v5m-5 0h10" />
                  </svg>
                  <span>
                    <strong>{equipmentLine(item)}</strong>
                    {item.note && <span className="ugra-dim">{item.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ugra-muted">
              {state.status === 'loading' ? 'Загружаем технику…' : 'Техника в профиле не указана'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
