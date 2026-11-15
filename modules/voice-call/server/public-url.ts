import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { trimEndChars } from '@ugra/contracts';

/** Файл, куда `pnpm demo:tunnel` пишет адрес быстрого туннеля cloudflared. */
export const TUNNEL_URL_FILE = '.demo/public-url';

export interface PublicUrl {
  /** Публичный адрес веба (HTTPS) или `null` — телефону нечего открыть. */
  url: string | null;
  /** Адрес страницы звонка для QR-кода. */
  callUrl: string | null;
  source: 'env' | 'tunnel' | null;
}

function clean(raw: string | undefined): string | null {
  const value = trimEndChars(raw?.trim() ?? '', '/');
  return /^https?:\/\/[^\s]+$/i.test(value) ? value : null;
}

function readTunnelFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Адрес быстрого туннеля cloudflared в его выводе: `https://<случайно>.trycloudflare.com`.
 * cloudflared печатает адрес в stderr вместе с рамкой и цветами — берём только сам URL.
 */
export function parseTunnelUrl(output: string): string | null {
  const match = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i.exec(output);
  return match ? match[0].toLowerCase() : null;
}

/** cloudflared выдаёт адрес сразу, но работает он только после регистрации соединения с краем сети. */
export function isTunnelRegistered(output: string): boolean {
  return /Registered tunnel connection/i.test(output);
}

/**
 * Адрес запасного туннеля pinggy (ssh на порт 443): `https://<id>.run.pinggy-free.link`
 * или `https://<id>.free.pinggy.net`. Ссылку на кабинет `dashboard.pinggy.io` пропускаем.
 */
export function parsePinggyUrl(output: string): string | null {
  const match = /https:\/\/[a-z0-9][a-z0-9-]*\.(?:run\.pinggy-free\.link|free\.pinggy\.net|a\.free\.pinggy\.link)/i.exec(output);
  return match ? match[0].toLowerCase() : null;
}

/** Запасной домен Serveo: извлекаем адрес сайта, пропуская ссылку на кабинет. */
export function parseServeoUrl(output: string): string | null {
  const match = /https:\/\/[a-z0-9][a-z0-9-]*\.serveousercontent\.com(?=[^a-z0-9.-]|$)/i.exec(output);
  return match ? match[0].toLowerCase() : null;
}

/** `PUBLIC_WEB_URL` из `.env` важнее адреса туннеля: адрес туннеля меняется при каждом запуске. */
export function resolvePublicUrl(
  env: Record<string, string | undefined>,
  tunnelFile = resolve(process.cwd(), TUNNEL_URL_FILE),
): PublicUrl {
  const fromEnv = clean(env.PUBLIC_WEB_URL);
  if (fromEnv) return { url: fromEnv, callUrl: `${fromEnv}/call`, source: 'env' };
  const fromTunnel = clean(readTunnelFile(tunnelFile));
  if (fromTunnel) return { url: fromTunnel, callUrl: `${fromTunnel}/call`, source: 'tunnel' };
  return { url: null, callUrl: null, source: null };
}
