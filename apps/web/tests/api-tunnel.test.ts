import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

it('гостевой вход просит API без браузерной заставки туннеля', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ user: { id: 'u-call-guest' } }));
  vi.stubGlobal('fetch', request);
  expect(await api.post('/api/session', { userId: 'u-call-guest' })).toEqual({ user: { id: 'u-call-guest' } });
  expect(request).toHaveBeenCalledWith('/api/session', expect.objectContaining({
    credentials: 'include',
    headers: expect.objectContaining({ 'X-Pinggy-No-Screen': '1' }),
  }));
});

it('HTML с HTTP 200 не считается успешным входом', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Enter site</html>')));
  await expect(api.post('/api/session', {})).rejects.toThrow('Туннель вернул страницу вместо API');
});
