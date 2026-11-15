// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBackgroundRefresh } from '../../../packages/ui/src/useBackgroundRefresh';

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Probe({ refresh }: { refresh: () => Promise<void> }) {
  useBackgroundRefresh(refresh);
  return null;
}
async function mount(refresh: () => Promise<void>) {
  await act(async () => root.render(createElement(Probe, { refresh })));
}

it('обновляет уже открытый кабинет каждые пять секунд и при возврате на вкладку', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  await mount(refresh);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(refresh).toHaveBeenCalledTimes(3);
});

it('не запускает параллельные запросы и продолжает после ошибки сети', async () => {
  let rejectRequest: (reason: Error) => void = () => undefined;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRequest = reject; })).mockResolvedValue(undefined);
  await mount(refresh);
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { rejectRequest(new Error('offline')); });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('не опрашивает скрытую страницу и снимает подписки при уходе', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  await mount(refresh);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(refresh).not.toHaveBeenCalled();
});
