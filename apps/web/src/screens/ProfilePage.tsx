import './profile.css';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { MetaResponse, ProfileOptionsResponse, ProfileResponse, User } from '@ugra/contracts';
import { Button, Icon, PersonAvatar, Select } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { departmentLabel, equipmentChoices, equipmentLine, placeLabel } from './profile-format';

interface ProfilePageProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
  onLogout: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: ProfileResponse };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PlaceCardProps {
  user: User;
  profile: ProfileResponse['profile'];
  options: ProfileOptionsResponse | null;
  api: ApiClient;
  onSaved: () => void;
}

/** «Где вы сидите»: корпус и кабинет; «Изменить» открывает форму прямо в карточке. */
function PlaceCard({ user, profile, options, api, onSaved }: PlaceCardProps): JSX.Element {
  const place = placeLabel(profile);
  const [editing, setEditing] = useState(false);
  const [building, setBuilding] = useState(profile?.building ?? '');
  const [cabinet, setCabinet] = useState(profile?.cabinet ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildings = options?.buildings ?? [];
  const open = (): void => {
    setBuilding(profile?.building ?? buildings[0]?.code ?? '');
    setCabinet(profile?.cabinet ?? '');
    setError(null);
    setEditing(true);
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (building === '' || cabinet.trim() === '') {
      setError('Укажите корпус и кабинет');
      return;
    }
    setBusy(true);
    setError(null);
    api
      .patch('/api/profile/place', { building, cabinet: cabinet.trim() })
      .then(() => {
        setEditing(false);
        onSaved();
      })
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="ugra-card profile-card" data-reveal>
      <div className="profile-card__head">
        <h2 className="profile-card__cap">Где вы сидите</h2>
        {!editing && (
          <button type="button" className="profile-link" onClick={open}>
            {place ? 'Изменить' : 'Указать'}
          </button>
        )}
      </div>

      {editing ? (
        <form className="profile-form" onSubmit={save}>
          <div className="profile-form__row">
            <div className="profile-form__field">
              <span className="profile-form__label">Корпус</span>
              <Select
                label="Корпус"
                value={building}
                options={buildings.map((item) => ({ value: item.code, label: item.label }))}
                onChange={setBuilding}
                className="profile-input"
              />
            </div>
            <label className="profile-form__field">
              <span className="profile-form__label">Кабинет</span>
              <input
                className="profile-input"
                value={cabinet}
                inputMode="numeric"
                placeholder="312"
                maxLength={16}
                onChange={(event) => setCabinet(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="profile-form__error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-form__actions">
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              Сохранить
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="profile-place">{place ?? 'Место не указано'}</p>
          <p className="profile-hint">
            {user.role === 'applicant'
              ? 'Помощник подставит это место, если вы его не назовёте.'
              : 'Место подставляется в обращения и помогает инженеру найти вас.'}
          </p>
        </>
      )}
    </section>
  );
}

interface EquipmentCardProps {
  profile: ProfileResponse['profile'];
  equipment: ProfileResponse['equipment'];
  options: ProfileOptionsResponse | null;
  api: ApiClient;
  onSaved: () => void;
}

/** «Ваша техника»: список из CMDB, «Добавить» — выбор техники (сначала из своего кабинета). */
function EquipmentCard({ profile, equipment, options, api, onSaved }: EquipmentCardProps): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(
    () => equipmentChoices(options?.equipment ?? [], profile, equipment),
    [options, profile, equipment],
  );

  const open = (): void => {
    setChoice(choices[0]?.value ?? '');
    setError(null);
    setAdding(true);
  };

  const add = (event: FormEvent): void => {
    event.preventDefault();
    if (choice === '') return;
    setBusy(true);
    setError(null);
    api
      .post('/api/profile/equipment', { equipmentId: choice })
      .then(() => {
        setAdding(false);
        onSaved();
      })
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const remove = (id: string): void => {
    setError(null);
    api
      .post(`/api/profile/equipment/${encodeURIComponent(id)}/remove`)
      .then(onSaved)
      .catch((cause: unknown) => setError(errorText(cause)));
  };

  return (
    <section className="ugra-card profile-card" data-reveal>
      <div className="profile-card__head">
        <h2 className="profile-card__cap">Ваша техника</h2>
        {!adding && choices.length > 0 && (
          <button type="button" className="profile-link" onClick={open}>
            + Добавить
          </button>
        )}
      </div>

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
              <button
                type="button"
                className="profile-device__remove"
                aria-label={`Открепить: ${equipmentLine(item)}`}
                title="Открепить"
                onClick={() => remove(item.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="profile-hint">Техника в профиле не указана</p>
      )}

      {adding && (
        <form className="profile-form" onSubmit={add}>
          <div className="profile-form__field">
            <span className="profile-form__label">Техника из учёта</span>
            <Select label="Техника" value={choice} options={choices} onChange={setChoice} className="profile-input" />
          </div>
          <div className="profile-form__actions">
            <Button type="submit" size="sm" loading={busy} disabled={busy || choice === ''}>
              Добавить
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p className="profile-form__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Экран 04 «Профиль»: кто вошёл, подразделение, рабочее место и техника из учёта.
 * Место и технику можно поменять здесь же: `PATCH /api/profile/place`, `POST /api/profile/equipment`.
 */
export function ProfilePage({ user, meta, api, onLogout }: ProfilePageProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [options, setOptions] = useState<ProfileOptionsResponse | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<ProfileResponse>('/api/profile')
      .then((profile) => {
        if (alive) setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (alive) setState({ status: 'error', message: errorText(error) });
      });
    return () => {
      alive = false;
    };
  }, [api, reload]);

  useEffect(() => {
    let alive = true;
    api
      .get<ProfileOptionsResponse>('/api/profile/options')
      .then((value) => {
        if (alive) setOptions(value);
      })
      .catch(() => {
        // Без справочника формы просто не предложат вариантов — профиль всё равно виден.
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const refresh = (): void => setReload((value) => value + 1);
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
          <PlaceCard
            key={`place-${reload}`}
            user={user}
            profile={state.profile.profile}
            options={options}
            api={api}
            onSaved={refresh}
          />
          <EquipmentCard
            profile={state.profile.profile}
            equipment={state.profile.equipment}
            options={options}
            api={api}
            onSaved={refresh}
          />
        </div>
      )}
    </div>
  );
}
