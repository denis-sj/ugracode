// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';

const state = vi.hoisted(() => ({ appLoaded: false, root: null as Root | null }));
vi.mock('react-dom/client', async (original) => {
  const client = await original<typeof import('react-dom/client')>();
  return { ...client, createRoot: (container: Element) => {
    state.root = client.createRoot(container);
    return state.root;
  } };
});
vi.mock('../src/App', () => {
  state.appLoaded = true;
  return { App: () => createElement('div', null, 'Диспетчерская') };
});
vi.mock('../../../modules/voice-call/web/PhoneCallPage', () => ({
  PhoneCallPage: () => createElement('button', null, 'Ответить'),
}));

afterEach(async () => {
  await act(async () => state.root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('телефон сразу получает звонок и не загружает остальные экраны', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/call?mobile=3');
  document.body.innerHTML = '<div id="root">Загружаем…</div>';
  await act(async () => { await import('../src/main'); });
  expect(document.querySelector('button')?.textContent).toBe('Ответить');
  expect(state.appLoaded).toBe(false);
});
