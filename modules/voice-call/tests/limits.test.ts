import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePublicUrl } from '../server/public-url';
import { RateLimiter, clientAddress } from '../server/rate-limit';

describe('лимит частоты', () => {
  it('пускает limit событий за окно, потом отказывает, после окна — снова пускает', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true);
    now = 60_001;
    expect(limiter.take('a')).toBe(true);
  });

  it('адрес: cf-connecting-ip → x-forwarded-for → x-real-ip → local', () => {
    expect(clientAddress({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })).toBe('1.1.1.1');
    expect(clientAddress({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' })).toBe('2.2.2.2');
    expect(clientAddress({ 'x-real-ip': '3.3.3.3' })).toBe('3.3.3.3');
    expect(clientAddress({})).toBe('local');
    expect(clientAddress(undefined)).toBe('local');
  });
});

describe('публичный адрес для QR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-url-'));
  const file = join(dir, 'public-url');
  writeFileSync(file, 'https://quiet-fox.trycloudflare.com\n');

  it('PUBLIC_WEB_URL из .env важнее туннеля', () => {
    expect(resolvePublicUrl({ PUBLIC_WEB_URL: 'https://demo.example.ru/' }, file)).toEqual({
      url: 'https://demo.example.ru',
      callUrl: 'https://demo.example.ru/call',
      source: 'env',
    });
  });

  it('без .env берёт адрес туннеля из файла', () => {
    expect(resolvePublicUrl({}, file)).toMatchObject({ callUrl: 'https://quiet-fox.trycloudflare.com/call', source: 'tunnel' });
  });

  it('нет ни .env, ни файла, или адрес мусорный → null', () => {
    expect(resolvePublicUrl({}, join(dir, 'missing'))).toEqual({ url: null, callUrl: null, source: null });
    expect(resolvePublicUrl({ PUBLIC_WEB_URL: 'javascript:alert(1)' }, join(dir, 'missing')).url).toBeNull();
  });
});
