import { describe, expect, it } from 'vitest';
import { parseTunnelUrl, resolvePublicUrl } from '../server/public-url';

describe('адрес страницы звонка для QR', () => {
  it('PUBLIC_WEB_URL из окружения важнее файла туннеля', () => {
    const result = resolvePublicUrl({ PUBLIC_WEB_URL: 'https://support.example.ru/' }, '/нет/такого/файла');
    expect(result).toEqual({
      url: 'https://support.example.ru',
      callUrl: 'https://support.example.ru/call',
      source: 'env',
    });
  });

  it('мусор в PUBLIC_WEB_URL игнорируется', () => {
    const result = resolvePublicUrl({ PUBLIC_WEB_URL: 'не адрес' }, '/нет/такого/файла');
    expect(result).toEqual({ url: null, callUrl: null, source: null });
  });

  it('вынимает адрес cloudflared из вывода с рамкой и цветами', () => {
    const output = [
      '\u001b[36m2026-11-14T16:00:00Z INF +--------------------------------------------------------------------------------------------+\u001b[0m',
      '\u001b[36m2026-11-14T16:00:00Z INF |  Your quick Tunnel has been created! Visit it at:                                             |\u001b[0m',
      '\u001b[36m2026-11-14T16:00:00Z INF |  https://funny-cat-312.trycloudflare.com                                                     |\u001b[0m',
      '\u001b[36m2026-11-14T16:00:00Z INF +--------------------------------------------------------------------------------------------+\u001b[0m',
    ].join('\n');
    expect(parseTunnelUrl(output)).toBe('https://funny-cat-312.trycloudflare.com');
  });

  it('без адреса туннеля возвращает null', () => {
    expect(parseTunnelUrl('INF Starting tunnel')).toBeNull();
    expect(parseTunnelUrl('')).toBeNull();
    expect(parseTunnelUrl('https://example.com')).toBeNull();
  });
});
