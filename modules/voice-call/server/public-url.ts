import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  const value = raw?.trim().replace(/\/+$/, '') ?? '';
  return /^https?:\/\/[^\s]+$/i.test(value) ? value : null;
}

function readTunnelFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
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
