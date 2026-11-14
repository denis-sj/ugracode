import 'dotenv/config';

/**
 * `pnpm demo:check` — смоук демо-сценария на живом стенде (API уже запущен).
 *
 * Проходит путь защиты по HTTP тем же порядком, что и человек на сцене:
 * заявитель → разбор → диспетчер → назначение → уведомление инженеру → авария → отчёты.
 * Ничего не пишет в базу напрямую: только публичные маршруты API, как из браузера.
 *
 * Проверки, которым нужна живая модель (`knowledge`, «приоритет высокий»), в режиме
 * заглушки помечаются `⏭` и не считаются провалом.
 *
 * После прогона в базе остаются два обращения (обычное и аварийное) и одно назначение —
 * перед защитой стенд возвращают в исходное состояние: `pnpm demo:reset`.
 */

const DEFAULT_BASE_URL = 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 10_000;
const ANALYSIS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

/** Модули, без которых сценарий защиты не проходит. */
const REQUIRED_MODULES = [
  'extraction',
  'priority',
  'routing',
  'emergency',
  'knowledge',
  'mass-incident',
  'report-shift',
  'reports-dashboard',
];

const PRINTER_TEXT = 'Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор';
const EMERGENCY_TEXT = 'Корпус Б, кабинет 312: идёт дым, пахнет горелым';

interface CliOptions {
  baseUrl: string;
  stub: boolean;
  help: boolean;
}

const HELP = [
  'pnpm demo:check [ключи]',
  '',
  '  --base-url <адрес>  адрес API (по умолчанию http://localhost:3001 или DEMO_API_URL)',
  '  --stub              стенд без ключа (AI_MODE=stub): проверки живой модели пропускаются',
  '  --help, -h          эта подсказка',
  '',
  'Порядок перед защитой:',
  '  1. docker compose up -d --build',
  '  2. pnpm demo:check            # или pnpm demo:check --stub, если нет ключа',
  '  3. pnpm demo:reset            # убрать обращения смоука из базы',
].join('\n');

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: process.env.DEMO_API_URL ?? DEFAULT_BASE_URL,
    stub: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? '';
    const [flag = '', inline] = raw.split('=', 2);
    const value = (): string => {
      const found = inline ?? argv[index + 1];
      if (!found || found.startsWith('--')) throw new Error(`не задано значение для ${flag}`);
      if (inline === undefined) index += 1;
      return found;
    };
    switch (flag) {
      case '--base-url':
        options.baseUrl = value();
        break;
      case '--stub':
        options.stub = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`неизвестный ключ «${flag}»`);
    }
  }
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new Error(`адрес API должен начинаться с http:// или https://: ${options.baseUrl}`);
  }
  return options;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiResult {
  status: number;
  json: unknown;
  text: string;
  /** Значение cookie сессии из `set-cookie` (первая пара). */
  cookie: string;
}

interface ApiOptions {
  method?: 'GET' | 'POST';
  cookie?: string;
  body?: unknown;
  timeoutMs?: number;
}

/** Запрос к API: без зависимостей, только `fetch` Node 22. Сеть/таймаут — исключение, не статус. */
async function callApi(baseUrl: string, path: string, options: ApiOptions = {}): Promise<ApiResult> {
  const { method = 'GET', cookie, body, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`нет ответа ${method} ${path} на ${baseUrl}: ${messageOf(error)}`, { cause: error });
  }
  const text = await response.text();
  const setCookie = response.headers.get('set-cookie') ?? '';
  return {
    status: response.status,
    json: parseJson(text),
    text,
    cookie: setCookie.split(';')[0] ?? '',
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Короткая причина ошибки API: `message` из тела, иначе начало текста ответа. */
function errorDetail(result: ApiResult): string {
  const message = asText(asRecord(result.json)['message']);
  if (message) return message;
  const trimmed = result.text.trim();
  return trimmed === '' ? 'пустой ответ' : trimmed.slice(0, 200);
}

interface UserRow {
  id: string;
  role: string;
  fullName: string;
}

interface RoleUsers {
  applicant: UserRow;
  dispatcher: UserRow;
  engineer: UserRow;
  manager: UserRow;
}

function readUsers(json: unknown): UserRow[] {
  const rows: UserRow[] = [];
  for (const item of asArray(asRecord(json)['users'])) {
    const row = asRecord(item);
    const id = asText(row['id']);
    const role = asText(row['role']);
    if (!id || !role) continue;
    rows.push({ id, role, fullName: asText(row['fullName']) ?? id });
  }
  return rows;
}

function pickUser(users: readonly UserRow[], role: string): UserRow {
  const found = users.find((user) => user.role === role);
  if (!found) throw new Error(`нет пользователя с ролью ${role} — база не засеяна? pnpm demo:reset`);
  return found;
}

/** Заявитель демо — Денис Соколов; если его нет, берём первого заявителя. */
const DEMO_APPLICANT_ID = 'u-applicant-1';

function pickApplicant(users: readonly UserRow[]): UserRow {
  return users.find((user) => user.id === DEMO_APPLICANT_ID) ?? pickUser(users, 'applicant');
}

/** Сессия одного пользователя: cookie хранится здесь, запросы идут от его имени. */
class Session {
  private cookie = '';

  constructor(
    private readonly baseUrl: string,
    readonly user: UserRow,
  ) {}

  async login(): Promise<void> {
    const result = await callApi(this.baseUrl, '/api/session', {
      method: 'POST',
      body: { userId: this.user.id },
    });
    if (result.status !== 200) {
      throw new Error(`вход «${this.user.fullName}»: HTTP ${result.status}: ${errorDetail(result)}`);
    }
    if (result.cookie === '') {
      throw new Error(`вход «${this.user.fullName}»: сервер не выдал cookie сессии`);
    }
    this.cookie = result.cookie;
  }

  get(path: string): Promise<ApiResult> {
    return callApi(this.baseUrl, path, { cookie: this.cookie });
  }

  post(path: string, body: unknown): Promise<ApiResult> {
    return callApi(this.baseUrl, path, { method: 'POST', cookie: this.cookie, body });
  }
}

type Status = 'ok' | 'fail' | 'warn' | 'skip';

interface Outcome {
  status: Status;
  message: string;
}

interface Check {
  title: string;
  run(): Promise<Outcome>;
}

const ok = (message: string): Outcome => ({ status: 'ok', message });
const fail = (message: string): Outcome => ({ status: 'fail', message });
const warn = (message: string): Outcome => ({ status: 'warn', message });
const skip = (message: string): Outcome => ({ status: 'skip', message });

const BADGES: Record<Status, string> = { ok: '✅', fail: '❌', warn: '⚠️', skip: '⏭️' };

interface PrinterResult {
  ticketId: string;
  analysis: Record<string, unknown>;
}

interface State {
  baseUrl: string;
  stub: boolean;
  aiMode: 'stub' | 'cloud' | null;
  priorities: string[];
  users: RoleUsers | null;
  applicant: Session | null;
  dispatcher: Session | null;
  engineer: Session | null;
  manager: Session | null;
  printer: PrinterResult | null;
  confirmed: { ticketId: string; engineerId: string; number: string } | null;
}

function newState(options: CliOptions): State {
  return {
    baseUrl: options.baseUrl,
    stub: options.stub,
    aiMode: null,
    priorities: [],
    users: null,
    applicant: null,
    dispatcher: null,
    engineer: null,
    manager: null,
    printer: null,
    confirmed: null,
  };
}

function requireSession(session: Session | null, role: string): Session {
  if (!session) throw new Error(`вход (${role}) не выполнен: проверка «Пользователи и вход» упала`);
  return session;
}

function requireUsers(state: State): RoleUsers {
  if (!state.users) throw new Error('пользователи не загружены: проверка «Пользователи и вход» упала');
  return state.users;
}

function requirePrinter(state: State): PrinterResult {
  if (!state.printer) throw new Error('обращение смоука не создано: проверка «Обращение заявителя» упала');
  return state.printer;
}

async function checkHealth(state: State): Promise<Outcome> {
  const result = await callApi(state.baseUrl, '/api/health', { timeoutMs: HEALTH_TIMEOUT_MS });
  if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${errorDetail(result)}`);
  const status = asText(asRecord(result.json)['status']);
  if (status !== 'ok') throw new Error(`status=${status ?? '—'}, ожидалось ok`);
  return ok(`status ok, ${state.baseUrl}`);
}

async function checkMeta(state: State): Promise<Outcome> {
  const result = await callApi(state.baseUrl, '/api/meta');
  if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${errorDetail(result)}`);
  const meta = asRecord(result.json);
  const modules = asArray(meta['modules']).flatMap((item) => {
    const id = asText(asRecord(item)['id']);
    return id === null ? [] : [id];
  });
  if (modules.length === 0) throw new Error('список модулей пуст — API стартовал без реестра');
  const missing = REQUIRED_MODULES.filter((id) => !modules.includes(id));
  if (missing.length > 0) {
    throw new Error(`нет модулей: ${missing.join(', ')} — проверьте FEATURES_OFF в .env`);
  }
  const aiMode = asText(meta['aiMode']);
  state.aiMode = aiMode === 'cloud' ? 'cloud' : 'stub';
  state.priorities = asArray(meta['priorities']).flatMap((item) => {
    const level = asText(item);
    return level === null ? [] : [level];
  });
  const fields = asArray(meta['fields']).length;
  return ok(`модулей ${modules.length}, полей ${fields}, aiMode ${aiMode ?? '—'}`);
}

async function checkMode(state: State): Promise<Outcome> {
  if (state.aiMode === null) throw new Error('режим неизвестен: /api/meta не ответил');
  if (state.aiMode === 'cloud') return ok('живая модель Polza (AI_MODE=cloud)');
  if (state.stub) return ok('заглушка без ключа — проверки модели пропущены (--stub)');
  throw new Error(
    'стенд на заглушке: в .env нет POLZA_API_KEY. Для проверки без ключа — pnpm demo:check --stub',
  );
}

async function checkUsers(state: State): Promise<Outcome> {
  const result = await callApi(state.baseUrl, '/api/users');
  if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${errorDetail(result)}`);
  const users = readUsers(result.json);
  if (users.length < 30) {
    throw new Error(
      `пользователей ${users.length}, ожидалось не меньше 30 — база не засеяна: pnpm demo:reset`,
    );
  }
  const roles: RoleUsers = {
    applicant: pickApplicant(users),
    dispatcher: pickUser(users, 'dispatcher'),
    engineer: pickUser(users, 'engineer'),
    manager: pickUser(users, 'manager'),
  };
  state.users = roles;
  state.applicant = new Session(state.baseUrl, roles.applicant);
  state.dispatcher = new Session(state.baseUrl, roles.dispatcher);
  state.engineer = new Session(state.baseUrl, roles.engineer);
  state.manager = new Session(state.baseUrl, roles.manager);
  await Promise.all([
    state.applicant.login(),
    state.dispatcher.login(),
    state.engineer.login(),
    state.manager.login(),
  ]);
  return ok(
    `${users.length} пользователей; вход: ${roles.applicant.fullName}, ${roles.dispatcher.fullName}, ` +
      `${roles.engineer.fullName}, ${roles.manager.fullName}`,
  );
}

/** Ждёт `GET /tickets/:id/analysis`, пока разбор не появится: создание обращения синхронное, но не мгновенное. */
async function waitAnalysis(session: Session, ticketId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const result = await session.get(`/api/tickets/${ticketId}/analysis`);
    lastStatus = result.status;
    if (result.status === 200) return asRecord(asRecord(result.json)['analysis']);
    if (result.status !== 404)
      throw new Error(`разбор ${ticketId}: HTTP ${result.status}: ${errorDetail(result)}`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`разбор не появился за ${ANALYSIS_TIMEOUT_MS / 1000} с (последний ответ ${lastStatus})`);
}

function readField(analysis: Record<string, unknown>, key: string): string | null {
  return asText(asRecord(asRecord(analysis['fields'])[key])['value']);
}

async function createAppeal(session: Session, text: string): Promise<{ appealId: string; ticketId: string }> {
  const result = await session.post('/api/appeals', { text, channel: 'chat', attachments: [] });
  if (result.status !== 200)
    throw new Error(`создание обращения: HTTP ${result.status}: ${errorDetail(result)}`);
  const body = asRecord(result.json);
  const ticketId = asText(body['ticketId']);
  const appealId = asText(body['appealId']);
  if (!ticketId || !appealId) throw new Error('в ответе на создание обращения нет ticketId/appealId');
  return { ticketId, appealId };
}

async function readTicket(session: Session, ticketId: string): Promise<Record<string, unknown>> {
  const result = await session.get(`/api/tickets/${ticketId}`);
  if (result.status !== 200)
    throw new Error(`заявка ${ticketId}: HTTP ${result.status}: ${errorDetail(result)}`);
  return asRecord(asRecord(result.json)['ticket']);
}

/**
 * Заявка, которая ждёт ответа заявителя, до диспетчера не дойдёт. Отвечаем «не знаю»
 * на первую карточку — тот же путь, что на демо (вариант «Не знаю»), — и ждём `in_review`.
 * Возвращает итоговый статус и признак, что карточку отвечали.
 */
async function ensureInReview(
  session: Session,
  created: { ticketId: string; appealId: string },
  analysis: Record<string, unknown>,
): Promise<{ status: string; answered: string | null }> {
  let status = asText((await readTicket(session, created.ticketId))['status']) ?? '—';
  if (status !== 'waiting_applicant') return { status, answered: null };

  const first = asArray(analysis['missing']).map((item) => asRecord(item))[0];
  const fieldKey = first ? asText(first['key']) : null;
  if (!fieldKey) return { status, answered: null };

  const answer = await session.post(`/api/appeals/${created.appealId}/messages`, {
    kind: 'answer',
    fieldKey,
    body: 'не знаю',
  });
  if (answer.status !== 200) {
    throw new Error(`ответ на карточку «${fieldKey}»: HTTP ${answer.status}: ${errorDetail(answer)}`);
  }
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    status = asText((await readTicket(session, created.ticketId))['status']) ?? '—';
    if (status !== 'waiting_applicant') return { status, answered: fieldKey };
    await sleep(POLL_INTERVAL_MS);
  }
  return { status, answered: fieldKey };
}

async function checkPrinterAppeal(state: State): Promise<Outcome> {
  const applicant = requireSession(state.applicant, 'заявитель');
  const created = await createAppeal(applicant, PRINTER_TEXT);
  const analysis = await waitAnalysis(applicant, created.ticketId);

  const cabinet = readField(analysis, 'cabinet');
  if (cabinet !== '312') throw new Error(`cabinet=${cabinet ?? '—'}, ожидалось 312 — текст не разобран`);
  const equipment = readField(analysis, 'equipment');
  if (!equipment) throw new Error('поле equipment не заполнено');
  // После сверки с CMDB `equipment` может быть id (`eq-printer-312`), а модель — в `model`.
  const model = readField(analysis, 'model');
  const object = readField(analysis, 'object');
  const haystack = [equipment, model, object].filter((value) => value !== null).join(' ');
  if (!/принтер|hp|laserjet|eq-printer/i.test(haystack)) {
    throw new Error(`equipment=«${equipment}» — не похоже на принтер HP по тексту`);
  }
  const priority = asText(asRecord(analysis['priority'])['value']);
  if (!priority) throw new Error('приоритет не посчитан: analysis.priority пуст');
  if (state.priorities.length > 0 && !state.priorities.includes(priority)) {
    throw new Error(`приоритет «${priority}» не из справочника (${state.priorities.join(', ')})`);
  }

  const { status, answered } = await ensureInReview(applicant, created, analysis);

  state.printer = { ticketId: created.ticketId, analysis };
  const shown = model ?? object ?? equipment;
  const answerNote = answered === null ? '' : `, ответ «не знаю» на карточку ${answered}`;
  return ok(`кабинет 312, «${shown}», приоритет ${priority}, статус ${status}${answerNote}`);
}

async function checkAnalysisAi(state: State): Promise<Outcome> {
  if (state.aiMode !== 'cloud') return skip('режим заглушки: статью и приоритет живой модели не проверяли');
  const analysis = requirePrinter(state).analysis;
  const knowledge = asArray(analysis['knowledge']).map((item) => asRecord(item));
  if (knowledge.length === 0) throw new Error('в разборе нет статьи базы знаний (knowledge пуст)');
  const first = knowledge[0];
  const title = first ? (asText(first['title']) ?? 'без названия') : 'без названия';
  const priority = asText(asRecord(analysis['priority'])['value']) ?? '—';
  if (priority !== 'high' && priority !== 'emergency') {
    return warn(`статья «${title}»; приоритет ${priority} — в сценарии демо ожидается high`);
  }
  return ok(`статья «${title}», приоритет ${priority}`);
}

/** Заявка смоука, если она уже ждёт диспетчера; иначе первая `in_review` из очереди. */
async function findConfirmable(dispatcher: Session, smokeId: string | undefined): Promise<string | null> {
  if (smokeId) {
    const own = await dispatcher.get(`/api/tickets/${smokeId}`);
    if (own.status === 200 && asText(asRecord(asRecord(own.json)['ticket'])['status']) === 'in_review') {
      return smokeId;
    }
  }
  const waiting = await dispatcher.get('/api/tickets?status=in_review&limit=1');
  if (waiting.status !== 200) {
    throw new Error(`очередь in_review: HTTP ${waiting.status}: ${errorDetail(waiting)}`);
  }
  const first = asArray(asRecord(waiting.json)['tickets'])[0];
  return first === undefined ? null : asText(asRecord(first)['id']);
}

async function checkDispatcher(state: State): Promise<Outcome> {
  const dispatcher = requireSession(state.dispatcher, 'диспетчер');
  const result = await dispatcher.get('/api/tickets?limit=50');
  if (result.status !== 200) throw new Error(`очередь: HTTP ${result.status}: ${errorDetail(result)}`);
  const tickets = asArray(asRecord(result.json)['tickets']);
  if (tickets.length === 0) throw new Error('очередь диспетчера пуста — база не засеяна: pnpm demo:reset');

  const ticketId = await findConfirmable(dispatcher, state.printer?.ticketId);
  if (!ticketId) return skip(`очередь ${tickets.length} заявок, но нет ни одной in_review для подтверждения`);

  const engineer = requireUsers(state).engineer;
  const confirmed = await dispatcher.post(`/api/tickets/${ticketId}/confirm`, { assigneeId: engineer.id });
  if (confirmed.status !== 200) {
    throw new Error(`подтверждение ${ticketId}: HTTP ${confirmed.status}: ${errorDetail(confirmed)}`);
  }
  const ticket = asRecord(confirmed.json);
  const status = asText(ticket['status']);
  if (status !== 'assigned')
    throw new Error(`после подтверждения статус ${status ?? '—'}, ожидался assigned`);
  const assignee = asText(ticket['assigneeId']);
  if (assignee !== engineer.id) throw new Error(`исполнитель ${assignee ?? '—'}, ожидался ${engineer.id}`);

  const number = asText(ticket['number']) ?? ticketId;
  state.confirmed = { ticketId, engineerId: engineer.id, number };
  return ok(`очередь ${tickets.length}; ${number} → ${engineer.fullName}`);
}

async function checkNotification(state: State): Promise<Outcome> {
  const confirmed = state.confirmed;
  if (!confirmed) return skip('подтверждения не было — уведомление проверять не на чем');
  const engineer = requireSession(state.engineer, 'инженер');
  const result = await engineer.get('/api/notifications');
  if (result.status !== 200) throw new Error(`уведомления: HTTP ${result.status}: ${errorDetail(result)}`);
  const notifications = asArray(asRecord(result.json)['notifications']).map((item) => asRecord(item));
  const found = notifications.find((item) => asText(item['ticketId']) === confirmed.ticketId);
  if (!found) {
    throw new Error(
      `уведомление по ${confirmed.number} не пришло (всего у инженера ${notifications.length}) — событие ticket.assigned`,
    );
  }
  const title = asText(found['title']) ?? 'уведомление';
  return ok(`инженеру ${engineer.user.fullName}: «${title}»`);
}

async function checkEmergency(state: State): Promise<Outcome> {
  const applicant = requireSession(state.applicant, 'заявитель');
  const created = await createAppeal(applicant, EMERGENCY_TEXT);
  const analysis = await waitAnalysis(applicant, created.ticketId);
  const level = asText(asRecord(analysis['emergency'])['level']);
  if (!level || level === 'none') throw new Error(`авария не распознана: level=${level ?? '—'}`);

  const ticket = await readTicket(applicant, created.ticketId);
  if (ticket['isEmergency'] !== true) {
    throw new Error('разбор видит аварию, а у заявки isEmergency=false — статус не перенесён');
  }
  return ok(`level=${level}, заявка помечена аварией`);
}

async function checkReports(state: State): Promise<Outcome> {
  const manager = requireSession(state.manager, 'руководитель');
  const dispatcher = requireSession(state.dispatcher, 'диспетчер');

  const shift = await manager.post('/api/m/report-shift/run', {});
  if (shift.status !== 200) throw new Error(`отчёт смены: HTTP ${shift.status}: ${errorDetail(shift)}`);
  const run = asRecord(shift.json);
  const total = asRecord(asRecord(run['report'])['totals'])['total'];
  if (typeof total !== 'number') throw new Error('в отчёте смены нет report.totals.total');
  const insight = asRecord(run['insight']);
  const source = asText(insight['source']) ?? '—';
  const meaning = asText(insight['meaning']);
  if (!meaning) throw new Error('в отчёте смены пустой вывод (insight.meaning)');

  const incidents = await dispatcher.get('/api/m/mass-incident/incidents');
  if (incidents.status !== 200)
    throw new Error(`инциденты: HTTP ${incidents.status}: ${errorDetail(incidents)}`);
  const list = asArray(asRecord(incidents.json)['incidents']);

  const insightNote = source === 'ai' ? 'вывод модели' : `вывод шаблоном (${source})`;
  if (state.aiMode === 'cloud' && source !== 'ai') {
    return warn(`смена: ${total} заявок, ${insightNote}; инцидентов ${list.length}`);
  }
  return ok(`смена: ${total} заявок, ${insightNote}; инцидентов ${list.length}`);
}

function buildChecks(state: State): Check[] {
  return [
    { title: 'API /api/health', run: () => checkHealth(state) },
    { title: 'Модули в /api/meta', run: () => checkMeta(state) },
    { title: 'Режим ИИ', run: () => checkMode(state) },
    { title: 'Пользователи и вход', run: () => checkUsers(state) },
    { title: 'Обращение заявителя и разбор', run: () => checkPrinterAppeal(state) },
    { title: 'Статья и приоритет (модель)', run: () => checkAnalysisAi(state) },
    { title: 'Диспетчер: очередь и назначение', run: () => checkDispatcher(state) },
    { title: 'Уведомление инженеру', run: () => checkNotification(state) },
    { title: 'Авария: дым и запах горелого', run: () => checkEmergency(state) },
    { title: 'Отчёты: смена и инциденты', run: () => checkReports(state) },
  ];
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    console.info(HELP);
    return 0;
  }

  const state = newState(options);
  const checks = buildChecks(state);
  console.info(`Демо-проверка: ${options.baseUrl}${options.stub ? ' (стенд без ключа)' : ''}`);
  console.info('');

  const startedAt = Date.now();
  const counts: Record<Status, number> = { ok: 0, fail: 0, warn: 0, skip: 0 };

  for (const [index, check] of checks.entries()) {
    const checkStartedAt = Date.now();
    let outcome: Outcome;
    try {
      outcome = await check.run();
    } catch (error) {
      outcome = fail(messageOf(error));
    }
    counts[outcome.status] += 1;
    const ms = Date.now() - checkStartedAt;
    console.info(`${index + 1}. ${BADGES[outcome.status]} ${check.title}: ${outcome.message} · ${ms} мс`);
    if (index === 0 && outcome.status === 'fail') {
      console.info('');
      console.info('Стенд не отвечает. Запустить: docker compose up -d --build, дождаться /api/health.');
      return 1;
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.info('');
  console.info(
    `Итог: ✅ ${counts.ok}, ❌ ${counts.fail}, ⚠️ ${counts.warn}, ⏭️ ${counts.skip} · ${seconds} с`,
  );
  if (counts.fail > 0) {
    console.info('Есть провалы: на защиту в таком виде не выходить.');
    return 1;
  }
  console.info('Смоук пройден. Перед защитой: pnpm demo:reset — убрать следы проверки из базы.');
  return 0;
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('demo-check.ts') || entry.endsWith('demo-check.js')) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(messageOf(error));
      process.exitCode = 1;
    });
}
