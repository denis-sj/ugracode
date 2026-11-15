import './team.css';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { MetaResponse, ProfileOptionsResponse, Role, User, UsersResponse } from '@ugra/contracts';
import { Button, PersonAvatar, Select } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { departmentLabel } from './profile-format';
import { ROLE_OPTIONS, roleTitle, teamGroups } from './team-format';

/** Фокус в первое поле формы при её появлении (вместо атрибута autoFocus). */
function focusOnMount(element: HTMLInputElement | null): void {
  element?.focus();
}

interface TeamPageProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NewEmployeeProps {
  meta: MetaResponse;
  api: ApiClient;
  onCreated: (user: User) => void;
  onClose: () => void;
}

/** Форма «Новый сотрудник»: имя, должность, роль и рабочее место. */
function NewEmployee({ meta, api, onCreated, onClose }: NewEmployeeProps): JSX.Element {
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [role, setRole] = useState<Role>('applicant');
  const [departmentId, setDepartmentId] = useState('');
  const [building, setBuilding] = useState('');
  const [cabinet, setCabinet] = useState('');
  const [buildings, setBuildings] = useState<ProfileOptionsResponse['buildings']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProfileOptionsResponse>('/api/profile/options')
      .then((options) => setBuildings(options.buildings))
      .catch(() => setBuildings([]));
  }, [api]);

  const departments = useMemo(
    () => [
      { value: '', label: 'Не указано' },
      ...meta.dictionaries
        .filter((item) => item.dictionary === 'department')
        .map((item) => ({ value: item.code, label: item.label })),
    ],
    [meta],
  );

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (fullName.trim().length < 3 || position.trim().length < 2) {
      setError('Укажите фамилию, имя и должность');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      fullName: fullName.trim(),
      position: position.trim(),
      role,
      departmentId: departmentId === '' ? null : departmentId,
      ...(building !== '' && cabinet.trim() !== '' ? { building, cabinet: cabinet.trim() } : {}),
    };
    api
      .post<{ user: User }>('/api/users', body)
      .then((response) => onCreated(response.user))
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <form className="ugra-card team-form" onSubmit={submit} data-reveal>
      <h2 className="team-form__title">Новый сотрудник</h2>
      <div className="team-form__grid">
        <label className="team-field">
          <span className="team-field__label">Фамилия и имя</span>
          <input
            className="team-input"
            value={fullName}
            placeholder="Мария Иванова"
            maxLength={80}
            ref={focusOnMount}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        <label className="team-field">
          <span className="team-field__label">Должность</span>
          <input
            className="team-input"
            value={position}
            placeholder="Инженер 1-й линии"
            maxLength={80}
            onChange={(event) => setPosition(event.target.value)}
          />
        </label>
        <div className="team-field">
          <span className="team-field__label">Роль</span>
          <Select label="Роль" value={role} options={ROLE_OPTIONS} onChange={(value) => setRole(value as Role)} className="team-input" />
        </div>
        <div className="team-field">
          <span className="team-field__label">Подразделение</span>
          <Select label="Подразделение" value={departmentId} options={departments} onChange={setDepartmentId} className="team-input" />
        </div>
        <div className="team-field">
          <span className="team-field__label">Корпус</span>
          <Select
            label="Корпус"
            value={building}
            options={[{ value: '', label: 'Не указан' }, ...buildings.map((item) => ({ value: item.code, label: item.label }))]}
            onChange={setBuilding}
            className="team-input"
          />
        </div>
        <label className="team-field">
          <span className="team-field__label">Кабинет</span>
          <input
            className="team-input"
            value={cabinet}
            placeholder="312"
            inputMode="numeric"
            maxLength={16}
            onChange={(event) => setCabinet(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="team-error" role="alert">
          {error}
        </p>
      )}
      <div className="team-form__actions">
        <Button type="submit" loading={busy} disabled={busy}>
          Добавить сотрудника
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/**
 * Вкладка руководителя «Сотрудники»: все учётки по ролям, смена роли и новый сотрудник.
 * Сервер проверяет право `settings`; свою роль руководитель не меняет.
 */
export function TeamPage({ user, meta, api }: TeamPageProps): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<UsersResponse>('/api/users')
      .then((response) => {
        if (alive) setUsers(response.users);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, reload]);

  const groups = useMemo(() => teamGroups(users), [users]);

  const changeRole = (target: User, role: Role): void => {
    if (role === target.role) return;
    setError(null);
    api
      .patch<{ user: User }>(`/api/users/${encodeURIComponent(target.id)}/role`, { role })
      .then((response) => {
        setUsers((list) => list.map((item) => (item.id === target.id ? response.user : item)));
        setFresh(target.id);
      })
      .catch((cause: unknown) => setError(errorText(cause)));
  };

  return (
    <div className="team-page">
      <header className="team-head" data-reveal>
        <div>
          <h1 className="ugra-page-title">Сотрудники</h1>
          <p className="team-lead">Кто работает в системе и с какой ролью. Роль определяет вкладки и права.</p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>+ Сотрудник</Button>}
      </header>

      {adding && (
        <NewEmployee
          meta={meta}
          api={api}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setFresh(created.id);
            setReload((value) => value + 1);
          }}
        />
      )}

      {error && (
        <p className="team-error" role="alert">
          {error}
        </p>
      )}

      {loading && users.length === 0 ? (
        <p className="team-lead">Загружаем сотрудников…</p>
      ) : (
        <div className="team-groups">
          {groups.map((group) => (
            <section className="ugra-card team-group" key={group.role} data-reveal>
              <h2 className="team-group__title">
                {group.title}
                <span className="team-group__count">{group.users.length}</span>
              </h2>
              <ul className="team-list">
                {group.users.map((person) => (
                  <li className={person.id === fresh ? 'team-row team-row--fresh' : 'team-row'} key={person.id}>
                    <PersonAvatar name={person.fullName} size={36} />
                    <span className="team-row__text">
                      <strong className="team-row__name">{person.fullName}</strong>
                      <span className="team-row__meta">
                        {person.position}
                        {person.departmentId ? ` · ${departmentLabel(meta, person.departmentId)}` : ''}
                      </span>
                    </span>
                    {person.id === user.id ? (
                      <span className="team-row__you">это вы</span>
                    ) : (
                      <div className="team-row__role">
                        <Select
                          label={`Роль: ${person.fullName}`}
                          value={person.role}
                          options={ROLE_OPTIONS}
                          onChange={(value) => changeRole(person, value as Role)}
                          className="team-input team-input--sm"
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="team-note">Всего: {users.length}. {roleTitle(user.role)} может менять роли всех, кроме своей.</p>
    </div>
  );
}
