import 'dotenv/config';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { isCallReachable, sshForwardTarget, waitForCall } from './tunnel-health';
import {
  TUNNEL_URL_FILE,
  isTunnelRegistered,
  parsePinggyUrl,
  parseServeoUrl,
  parseTunnelUrl,
} from '../modules/voice-call/server/public-url';

/**
 * `pnpm demo:tunnel` — HTTPS-адрес для телефона: отсканировал QR — и страница звонка уже готова.
 *
 * 1. Собирает веб и отдаёт сборку через `vite preview` на 4173 (5 файлов вместо ~190 модулей
 *    dev-сервера; `/api` проксируется на API). `--dev` — туннель на dev-сервер 5173, как раньше.
 * 2. Поднимает быстрый туннель cloudflared (HTTP/2 по TCP) и публикует адрес **только после**
 *    регистрации соединения: раньше QR вёл на мёртвый адрес (ошибка 1033), если сеть или VPN
 *    не пускали cloudflared.
 * 3. Не зарегистрировался за 25 с — запасной туннель pinggy через ssh на 443 порт
 *    (на телефоне один раз нажать «Enter site»; бесплатный туннель живёт 60 минут).
 *
 * Адрес пишется в `.demo/public-url`; QR и ссылка доступны только в терминале.
 * Перед публикацией проверяются публичные /call и /api/health.
 */

const DEV = process.argv.includes('--dev');
const SERVEO = process.argv.includes('--serveo');
const PREVIEW_PORT = SERVEO ? 4174 : 4173;
const TARGET = process.env.DEMO_TUNNEL_TARGET ?? (DEV ? 'http://localhost:5173' : `http://localhost:${PREVIEW_PORT}`);
const FILE = resolve(process.cwd(), TUNNEL_URL_FILE);
const CLOUDFLARE_WAIT_MS = 25_000;
const VITE_CONFIG = 'apps/web/vite.config.ts';

const children: ChildProcess[] = [];
let stopping = false;
/** Какой туннель опубликован: падение другого (отброшенного) туннеля не останавливает скрипт. */
let publishedVia: string | null = null;

function saveUrl(url: string): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${url}\n`, 'utf8');
}

function dropUrl(): void {
  rmSync(FILE, { force: true });
}

function track(child: ChildProcess): ChildProcess {
  children.push(child);
  return child;
}

function stopAll(code = 0): void {
  stopping = true;
  dropUrl();
  for (const child of children) child.kill('SIGINT');
  process.exitCode = code;
}

async function printQr(url: string, via: string): Promise<void> {
  const callUrl = `${url}/call`;
  const qr = await QRCode.toString(callUrl, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });
  console.info('');
  console.info(qr);
  console.info(`  Туннель: ${via}`);
  console.info(`  Страница звонка: ${callUrl}`);
  console.info(`  Экран диспетчера: http://localhost:5173/#/calls — разговор появится автоматически.`);
  if (via === 'serveo') console.info('  На телефоне на заставке Serveo нажмите «Continue to Site».');
  if (via === 'pinggy') {
    console.info('  На телефоне один раз нажмите «Enter site» — это заставка бесплатного pinggy. Туннель живёт 60 минут.');
  }
  console.info('  Остановить — Ctrl+C.');
  console.info('');
}

async function publish(url: string, via: string): Promise<void> {
  publishedVia = via;
  saveUrl(url);
  try {
    await printQr(url, via);
  } catch (error) {
    console.error(`QR не нарисовался: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Сборка и `vite preview`: ждём, пока порт ответит. */
async function startPreview(): Promise<void> {
  console.info('Собираю веб для телефона…');
  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', VITE_CONFIG], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('сборка веба упала — запустите `pnpm demo:tunnel --dev`');

  if (await isCallReachable(TARGET)) {
    console.info('Использую уже запущенный preview с обновлённой сборкой.');
    return;
  }

  const preview = track(
    spawn('pnpm', ['exec', 'vite', 'preview', '--config', VITE_CONFIG, '--port', String(PREVIEW_PORT), '--strictPort'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  );
  preview.on('error', (error) => console.error(`Не удалось запустить preview: ${error.message}`));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (preview.exitCode !== null) break;
    if (await isCallReachable(TARGET)) {
      console.info(`Сборка отдаётся на :${PREVIEW_PORT}, API отвечает.`);
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`vite preview или API не ответили на :${PREVIEW_PORT} (API запущен? pnpm dev:api)`);
}

/** cloudflared: адрес — только после «Registered tunnel connection». */
function tryCloudflare(): Promise<string | null> {
  return new Promise((done) => {
    const child = track(
      spawn('cloudflared', ['tunnel', '--protocol', 'http2', '--url', TARGET], { stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    let output = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value === null) child.kill('SIGINT');
      done(value);
    };
    const timer = setTimeout(() => {
      console.warn('cloudflared не подключился за 25 с (сеть или VPN режут порт 7844) — переключаюсь на pinggy.');
      finish(null);
    }, CLOUDFLARE_WAIT_MS);
    const scan = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-65_536);
      const url = parseTunnelUrl(output);
      if (url !== null && isTunnelRegistered(output)) finish(url);
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('error', () => {
      console.warn('Нет cloudflared (brew install cloudflared) — переключаюсь на pinggy.');
      finish(null);
    });
    child.on('exit', () => {
      if (!settled) finish(null);
      else if (!stopping && publishedVia === 'cloudflared') {
        console.error('cloudflared закрылся — адрес убран. Перезапустите: pnpm demo:tunnel');
        stopAll(1);
      }
    });
  });
}

/** Запасной путь: ssh-туннель pinggy на 443 порт — проходит почти через любую сеть. */
function trySsh(provider: 'pinggy' | 'serveo' = 'pinggy'): Promise<string | null> {
  return new Promise((done) => {
    const forward = sshForwardTarget(TARGET, provider === 'serveo' ? 80 : 0);
    const child = track(
      spawn(
        'ssh',
        [
          '-T',
          '-p',
          '443',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-o',
          'ServerAliveInterval=30',
          '-o',
          'ExitOnForwardFailure=yes',
          '-R',
          forward,
          provider === 'serveo' ? 'serveo.net' : 'free.pinggy.io',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    let output = '';
    let settled = false;
    const timer = setTimeout(() => finish(null), 20_000);
    function finish(value: string | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value === null) child.kill('SIGINT');
      done(value);
    }
    const scan = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-65_536);
      const url = provider === 'serveo' ? parseServeoUrl(output) : parsePinggyUrl(output);
      if (url) finish(url);
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('error', () => finish(null));
    child.on('exit', () => {
      if (!settled) finish(null);
      else if (!stopping && publishedVia === provider) {
        // Бесплатный pinggy рвётся сам (лимит 60 мин, обрывы сети) — переподключаемся, QR обновится сам.
        console.warn(`${provider} закрылся — переподключаюсь…`);
        publishedVia = null;
        void reconnectSsh(provider);
      }
    });
  });
}

/** Переподключение pinggy: до 10 попыток с паузой; новый адрес сразу уходит в `.demo/public-url`. */
async function reconnectSsh(provider: 'pinggy' | 'serveo'): Promise<void> {
  dropUrl();
  for (let attempt = 1; attempt <= 10 && !stopping; attempt += 1) {
    await new Promise((done) => setTimeout(done, 3000));
    const url = await trySsh(provider);
    if (url && !stopping && await waitForCall(url)) {
      await publish(url, provider);
      return;
    }
    console.warn(`${provider}: попытка ${attempt} не удалась`);
  }
  if (!stopping) {
    console.error(`${provider} не переподключился — перезапустите: pnpm demo:tunnel${SERVEO ? ' --serveo' : ''}`);
    stopAll(1);
  }
}

async function main(): Promise<void> {
  process.on('SIGINT', () => stopAll(0));
  process.on('SIGTERM', () => stopAll(0));
  dropUrl();

  if (!DEV && !process.env.DEMO_TUNNEL_TARGET) await startPreview();
  if (!(await isCallReachable(TARGET))) throw new Error(`Страница звонка или API недоступны на ${TARGET}. Запустите API и веб.`);
  console.info(`Поднимаю туннель на ${TARGET}…`);

  if (SERVEO) {
    const url = await trySsh('serveo');
    if (url && !stopping && await waitForCall(url)) await publish(url, 'serveo');
    else stopAll(1);
    return;
  }

  const cloudflare = await tryCloudflare();
  if (cloudflare && await waitForCall(cloudflare)) {
    await publish(cloudflare, 'cloudflared');
    return;
  }
  if (cloudflare) {
    console.warn('Cloudflare зарегистрирован, но публичная страница или API не отвечают — пробую pinggy.');
    children.at(-1)?.kill('SIGINT');
  }
  const pinggy = await trySsh();
  if (pinggy && await waitForCall(pinggy)) {
    await publish(pinggy, 'pinggy');
    return;
  }
  console.error('Туннель не поднялся. Звонок работает на этом ноутбуке: http://localhost:5173/call');
  stopAll(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopAll(1);
});
