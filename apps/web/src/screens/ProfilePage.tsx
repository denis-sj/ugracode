import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse, ProfileResponse, User } from '@ugra/contracts';
import type { ApiClient } from '@ugra/ui';
import { departmentLabel, equipmentLine, placeLabel, profileFilled, ROLE_TITLE } from './profile-format';

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
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; profile: ProfileResponse }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .get<ProfileResponse>('/api/profile')
      .then((profile) => {
        if (alive) setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const profile = state.status === 'ready' ? state.profile.profile : null;
  const equipment = state.status === 'ready' ? state.profile.equipment : [];
  const place = placeLabel(profile);
  const filled = profileFilled(profile, equipment);

  return (
    <div className="profile-page">
      <section className="profile-hero ugra-card">
        <span className="shell-avatar shell-avatar--large" aria-hidden="true">
          {initials(user.fullName)}
        </span>
        <div className="profile-hero__text">
          <h1>{user.fullName}</h1>
          <p className="ugra-muted">{user.position}</p>
          <p className="profile-hero__meta">
            <span className="profile-role">{ROLE_TITLE[user.role] ?? user.role}</span>
            <span aria-hidden="true">·</span>
            {departmentLabel(meta, user.departmentId)}
          </p>
        </div>
      </section>

      <div className="profile-grid">
        <section className="ugra-card profile-card" data-reveal>
          <h2>Рабочее место</h2>
          {state.status === 'loading' && <p className="ugra-muted">Загружаем профиль…</p>}
          {state.status === 'error' && (
            <p className="ugra-muted">Не удалось загрузить профиль: {state.message}</p>
          )}
          {state.status === 'ready' && !filled && (
            <p className="ugra-muted">
              {user.role === 'applicant'
                ? 'Профиль не заполнен. Место и технику уточним в чате при обращении.'
                : 'Для этой роли рабочее место в профиле не ведётся.'}
            </p>
          )}
          {state.status === 'ready' && filled && (
            <>
              <dl className="profile-rows">
                <div>
                  <dt>Корпус</dt>
                  <dd>{profile?.building ?? '—'}</dd>
                </div>
                <div>
                  <dt>Этаж</dt>
                  <dd>{profile?.floor ?? '—'}</dd>
                </div>
                <div>
                  <dt>Кабинет</dt>
                  <dd>{profile?.cabinet ?? '—'}</dd>
                </div>
                <div>
                  <dt>Адрес</dt>
                  <dd>{place ?? '—'}</dd>
                </div>
              </dl>
              {equipment.length > 0 && (
                <>
                  <h3 className="profile-subtitle">Техника</h3>
                  <ul className="profile-equipment">
                    {equipment.map((item) => (
                      <li key={item.id}>
                        <span>{equipmentLine(item)}</span>
                        {item.note && <span className="ugra-dim"> · {item.note}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        <section className="ugra-card profile-card" data-reveal>
          <h2>Сессия</h2>
          <dl className="profile-rows">
            <div>
              <dt>Роль</dt>
              <dd>{ROLE_TITLE[user.role] ?? user.role}</dd>
            </div>
            <div>
              <dt>Подразделение</dt>
              <dd>{departmentLabel(meta, user.departmentId)}</dd>
            </div>
            <div>
              <dt>Идентификатор</dt>
              <dd>{user.id}</dd>
            </div>
          </dl>
          <p className="ugra-muted profile-hint">
            Тема (светлая / тёмная) переключается кнопкой в шапке и запоминается на этом устройстве.
          </p>
          <button type="button" className="ugra-btn ugra-btn--secondary" onClick={onLogout}>
            Сменить пользователя
          </button>
        </section>
      </div>
    </div>
  );
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}
