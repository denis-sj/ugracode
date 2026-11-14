// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetaResponse, User } from '@ugra/contracts';
import type { ApiClient } from '@ugra/ui';
import { ProfilePage } from '../src/screens/ProfilePage';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const user = {
  id: 'u-1',
  fullName: 'Антон Гриценко',
  role: 'applicant',
  position: 'Экономист',
  departmentId: null,
} as User;
const meta = { dictionaries: [] } as unknown as MetaResponse;
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

async function renderProfile(get: ApiClient['get']) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  const logout = vi.fn();
  await act(async () =>
    root.render(createElement(ProfilePage, { user, meta, api: { get } as ApiClient, onLogout: logout })),
  );
  return { host, logout };
}

describe('profile handoff', () => {
  it('shows actual place and equipment, without duplicating session internals', async () => {
    const get = vi.fn().mockResolvedValue({
      profile: { building: 'Б', cabinet: '312', floor: '3' },
      equipment: [{ id: 'e1', label: 'HP LaserJet', note: 'Принтер' }],
    });
    const { host, logout } = await renderProfile(get);
    expect(host.textContent).toContain('Корпус Б · 3 этаж · каб. 312');
    expect(host.textContent).toContain('HP LaserJet');
    expect(host.textContent).not.toContain('Идентификатор');
    await act(async () => host.querySelector('button')!.click());
    expect(logout).toHaveBeenCalledOnce();
  });
  it('explains an empty profile', async () => {
    const { host } = await renderProfile(vi.fn().mockResolvedValue({ profile: null, equipment: [] }));
    expect(host.textContent).toContain('Место не указано');
    expect(host.textContent).toContain('Техника в профиле не указана');
  });
  it('shows API failures rather than invented profile data', async () => {
    const { host } = await renderProfile(vi.fn().mockRejectedValue(new Error('Сеть недоступна')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Сеть недоступна');
  });
});
