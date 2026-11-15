import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCallReachable, sshForwardTarget, waitForCall } from '../../../scripts/tunnel-health';

afterEach(() => vi.unstubAllGlobals());

function workingFetch(): typeof fetch {
  return vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).endsWith('/call')
      ? new Response('<html><div id="root"></div></html>')
      : Response.json({ status: 'ok', service: 'api' }),
  );
}

describe('проверка туннеля до публикации QR', () => {
  it('проверяет страницу и API по одному публичному адресу', async () => {
    const request = workingFetch();
    expect(await isCallReachable('https://demo.example', request)).toBe(true);
    expect(request).toHaveBeenCalledWith('https://demo.example/api/health', expect.any(Object));
  });

  it('не принимает заставку pinggy за страницу звонка', async () => {
    const request = workingFetch();
    vi.mocked(request).mockResolvedValueOnce(new Response('Enter site'));
    expect(await isCallReachable('https://demo.example', request)).toBe(false);
  });

  it('проверяет Safari с подтверждением Enter site и cookie, а не серверный обход', async () => {
    const request = workingFetch();
    vi.mocked(request)
      .mockResolvedValueOnce(new Response('<script>X-Pinggy-No-Screen-Cookie</script>'))
      .mockResolvedValueOnce(new Response('', { headers: { 'set-cookie': 'consent=yes; Path=/; HttpOnly' } }));
    expect(await isCallReachable('https://demo.example', request)).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, 'https://demo.example/call', expect.objectContaining({
      headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('iPhone') }),
    }));
    expect(request).toHaveBeenNthCalledWith(3, 'https://demo.example/call', expect.objectContaining({
      headers: expect.objectContaining({ Cookie: 'consent=yes' }),
    }));
  });

  it('не считает подтверждённой заставку без cookie', async () => {
    const request = workingFetch();
    vi.mocked(request)
      .mockResolvedValueOnce(new Response('X-Pinggy-No-Screen-Cookie'))
      .mockResolvedValueOnce(new Response(''));
    expect(await isCallReachable('https://demo.example', request)).toBe(false);
  });

  it.each([403, 530])('не публикует HTTP %s', async (status) => {
    const request = workingFetch();
    vi.mocked(request).mockResolvedValueOnce(new Response('error', { status }));
    expect(await isCallReachable('https://demo.example', request)).toBe(false);
  });

  it.each(['{"status":"down"}', '<html>proxy error</html>', 'null'])('отклоняет неисправный API: %s', async (body) => {
    const request = workingFetch();
    vi.mocked(request).mockResolvedValueOnce(new Response('<div id="root"></div>')).mockResolvedValueOnce(new Response(body));
    expect(await isCallReachable('https://demo.example', request)).toBe(false);
  });

  it('обрабатывает сетевой сбой', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('DNS failed'));
    expect(await isCallReachable('https://demo.example', request)).toBe(false);
  });

  it('дожидается доступности и останавливается после последней неудачи', async () => {
    vi.stubGlobal('fetch', workingFetch());
    expect(await waitForCall('https://demo.example', 1)).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await waitForCall('https://demo.example', 1)).toBe(false);
  });

  it('повторяет запрос, когда DNS заработал со второй попытки', async () => {
    const request = workingFetch();
    vi.mocked(request).mockRejectedValueOnce(new Error('DNS failed'));
    vi.stubGlobal('fetch', request);
    expect(await waitForCall('https://demo.example', 2)).toBe(true);
  });

  it('SSH учитывает хост и стандартный порт целевого сервера', () => {
    expect(sshForwardTarget('http://127.0.0.1:4173')).toBe('0:127.0.0.1:4173');
    expect(sshForwardTarget('http://web')).toBe('0:web:80');
    expect(sshForwardTarget('http://localhost:4174', 80)).toBe('80:localhost:4174');
    expect(() => sshForwardTarget('https://web')).toThrow('http://');
  });
});
