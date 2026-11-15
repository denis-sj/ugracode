// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ApiClient, WebPageProps } from '@ugra/ui';
import type { MetaResponse } from '@ugra/contracts';
import { CallsPage } from '../../../modules/voice-call/web/CallsPage';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

it.each(['empty', 'forbidden', 'offline'])('экран звонков без QR, ссылок и запросов адреса: %s', async (mode) => {
  const get = vi.fn().mockImplementation(async () => {
    if (mode === 'forbidden') throw Object.assign(new Error('Forbidden'), { status: 403 });
    if (mode === 'offline') throw new Error('offline');
    return { calls: [] };
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const api: ApiClient = { get, post: vi.fn(), patch: vi.fn() };
  const props: WebPageProps = {
    api,
    navigate: vi.fn(),
    user: { id: 'u-dispatcher-1', fullName: 'Анна Миронова', role: 'dispatcher', position: '', departmentId: null },
    meta: {} as MetaResponse,
    query: new URLSearchParams(),
  };
  await act(async () => root!.render(createElement(CallsPage, props)));
  expect(host.textContent).toContain(mode === 'forbidden' ? 'Нужен вход диспетчером' : mode === 'offline' ? 'Нет связи с сервером' : 'Звонков пока нет');
  expect(host.textContent).not.toMatch(/QR|demo:tunnel|PUBLIC_WEB_URL/);
  expect(host.querySelector('.voice-qr')).toBeNull();
  expect(get.mock.calls.every(([url]) => url === '/api/m/voice-call/calls')).toBe(true);
});
