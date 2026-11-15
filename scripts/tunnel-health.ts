/** Проверяем и страницу, и API: регистрация туннеля сама по себе не гарантирует доступ. */
export async function isCallReachable(baseUrl: string, request: typeof fetch = fetch): Promise<boolean> {
  try {
    // Safari получает заставку, которую обычный серверный fetch не видит.
    const options = {
      signal: AbortSignal.timeout(4000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      },
    };
    let page = await request(`${baseUrl}/call`, options);
    let html = await page.text();
    let cookie = '';
    if (html.includes('X-Pinggy-No-Screen-Cookie')) {
      // Точно воспроизводим единственное нажатие Enter site и сохранение cookie браузером.
      const consent = await request(`${baseUrl}/call`, {
        ...options,
        headers: { ...options.headers, 'X-Pinggy-No-Screen-Cookie': 'true' },
      });
      cookie = consent.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      if (!cookie) return false;
      page = await request(`${baseUrl}/call`, { ...options, headers: { ...options.headers, Cookie: cookie } });
      html = await page.text();
    }
    const health = await request(`${baseUrl}/api/health`, {
      ...options,
      headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), 'X-Pinggy-No-Screen': '1' },
    });
    if (!page.ok || !health.ok) return false;
    const status = await health.json() as { status?: string; service?: string } | null;
    return html.includes('id="root"') && status?.status === 'ok' && status.service === 'api';
  } catch {
    return false;
  }
}

/** HTTPS-туннель может получить адрес раньше, чем DNS и прокси начнут отвечать. */
export async function waitForCall(baseUrl: string, attempts = 6): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isCallReachable(baseUrl)) return true;
    if (attempt + 1 < attempts) await new Promise((done) => setTimeout(done, 1000));
  }
  return false;
}

/** SSH должен пробрасывать именно DEMO_TUNNEL_TARGET, включая нестандартный хост и порт. */
export function sshForwardTarget(target: string, publicPort = 0): string {
  const url = new URL(target);
  if (url.protocol !== 'http:') throw new Error('Для SSH-туннеля DEMO_TUNNEL_TARGET должен быть http://');
  return `${publicPort}:${url.hostname}:${url.port || '80'}`;
}
