import { describe, expect, it } from 'vitest';
import { isTunnelRegistered, parsePinggyUrl, parseServeoUrl, parseTunnelUrl, resolvePublicUrl } from '../server/public-url';

describe('адрес страницы звонка для QR', () => {
  it('Serveo: берёт только адрес сайта, не кабинет и не похожий чужой домен', () => {
    expect(parseServeoUrl('\u001b[32mForwarding HTTP traffic from https://abc-12.serveousercontent.com\r\n')).toBe('https://abc-12.serveousercontent.com');
    expect(parseServeoUrl('https://console.serveo.net/settings')).toBeNull();
    expect(parseServeoUrl('https://abc.serveousercontent.com.evil.example')).toBeNull();
    expect(parseServeoUrl('')).toBeNull();
  });
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

  it('cloudflared готов только после регистрации соединения', () => {
    expect(isTunnelRegistered('INF Registered tunnel connection connIndex=0 protocol=http2')).toBe(true);
    expect(isTunnelRegistered('INF |  https://funny-cat-312.trycloudflare.com  |')).toBe(false);
    expect(isTunnelRegistered('ERR Failed to dial a quic connection')).toBe(false);
  });

  it('вынимает адрес pinggy и пропускает ссылку на кабинет', () => {
    const output = [
      'You are not authenticated.',
      'Your tunnel will expire in 60 minutes. https://dashboard.pinggy.io',
      'http://luonm-80-243-16-204.run.pinggy-free.link',
      'https://luonm-80-243-16-204.run.pinggy-free.link',
    ].join('\n');
    expect(parsePinggyUrl(output)).toBe('https://luonm-80-243-16-204.run.pinggy-free.link');
    expect(parsePinggyUrl('https://myxkb-80-243-16-204.free.pinggy.net')).toBe('https://myxkb-80-243-16-204.free.pinggy.net');
  });

  it('без адреса pinggy возвращает null', () => {
    expect(parsePinggyUrl('https://dashboard.pinggy.io')).toBeNull();
    expect(parsePinggyUrl('')).toBeNull();
  });
});
