import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { TUNNEL_URL_FILE, parseTunnelUrl } from '../modules/voice-call/server/public-url';

/**
 * `pnpm demo:tunnel` — HTTPS-адрес для телефона жюри без аккаунта и без сертификатов.
 *
 * Запускает быстрый туннель cloudflared на локальный Vite (5173), вынимает из его вывода
 * адрес `https://*.trycloudflare.com`, печатает адрес и QR страницы `/call` прямо в терминал
 * и пишет адрес в `.demo/public-url`. Оттуда его забирает `GET /api/m/voice-call/public-url`,
 * а экран диспетчера рисует QR на проекторе: адрес меняется при каждом запуске, держать его
 * в `.env` руками бессмысленно.
 *
 * Туннелируем только Vite: он сам проксирует `/api` на API, второй туннель не нужен.
 */

const TARGET = process.env.DEMO_TUNNEL_TARGET ?? 'http://localhost:5173';
const FILE = resolve(process.cwd(), TUNNEL_URL_FILE);

function saveUrl(url: string): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${url}\n`, 'utf8');
}

function dropUrl(): void {
  try {
    rmSync(FILE, { force: true });
  } catch {
    /* файла нет — и хорошо */
  }
}

async function printQr(url: string): Promise<void> {
  const callUrl = `${url}/call`;
  const qr = await QRCode.toString(callUrl, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });
  console.info('');
  console.info(qr);
  console.info(`  Страница звонка: ${callUrl}`);
  console.info(`  Экран диспетчера: ${url}/#/calls`);
  console.info('');
  console.info(`  Адрес записан в ${TUNNEL_URL_FILE}. Пока cloudflared работает, QR на экране диспетчера обновится сам.`);
  console.info('  Остановить туннель — Ctrl+C.');
  console.info('');
}

function main(): void {
  console.info(`Запускаю cloudflared: ${TARGET} → https://*.trycloudflare.com`);
  console.info('Первый запуск может занять 5–10 секунд и потребовать сеть без корпоративных блокировок.');

  const child = spawn('cloudflared', ['tunnel', '--url', TARGET], { stdio: ['ignore', 'pipe', 'pipe'] });
  let url: string | null = null;
  let stopping = false;

  const scan = (chunk: Buffer | string): void => {
    if (url !== null) return;
    const found = parseTunnelUrl(chunk.toString());
    if (!found) return;
    url = found;
    saveUrl(found);
    void printQr(found).catch((error: unknown) => {
      console.error(`QR не нарисовался: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  child.stdout.on('data', scan);
  child.stderr.on('data', scan);

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error('Нет cloudflared: brew install cloudflared');
      console.error('Без туннеля звонок работает на этом ноутбуке: http://localhost:5173/call (микрофон на localhost разрешён).');
    } else {
      console.error(`cloudflared не запустился: ${error.message}`);
      console.error('Проверьте сеть и повторите: pnpm demo:tunnel');
    }
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    dropUrl();
    if (stopping) {
      console.info(`Туннель остановлен (${signal ?? code ?? 0}), адрес из ${TUNNEL_URL_FILE} убран.`);
      return;
    }
    if (url === null) {
      console.error('cloudflared завершился, не выдав адрес. Проверьте вывод выше.');
      process.exitCode = 1;
      return;
    }
    console.error(`Туннель закрылся (${signal ?? code ?? 0}). Для новой попытки: pnpm demo:tunnel`);
  });

  const stop = (): void => {
    stopping = true;
    child.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
