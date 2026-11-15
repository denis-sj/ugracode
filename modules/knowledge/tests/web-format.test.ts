import { describe, expect, it } from 'vitest';
import type { MetaResponse, Ticket } from '@ugra/contracts';
import {
  activeTasks,
  articleRows,
  articleStats,
  articleSummary,
  askModeLabel,
  buildDraft,
  categoryLabels,
  categoryName,
  dedupeArticles,
  filterArticles,
  formatScore,
  normalizeArticle,
  pluralRu,
  queryWords,
  relatedGroups,
  sourceLinks,
  stepKey,
  stepsDone,
} from '../web/format';
import type { KnowledgeArticle, SimilarTicket } from '../web/format';

function article(overrides: Partial<KnowledgeArticle> = {}): KnowledgeArticle {
  return {
    id: 'kb-print-red',
    title: 'Принтер мигает красным индикатором',
    symptoms: ['принтер не печатает', 'красный индикатор'],
    steps: ['Открыть лоток', 'Проверить картридж', 'Распечатать тестовую страницу'],
    solution: 'Обычно помогает замена картриджа или перезапуск устройства.',
    category: 'printer',
    score: 3,
    ...overrides,
  };
}

const SECOND = article({
  id: 'kb-network-vpn',
  title: 'VPN не подключается',
  symptoms: ['VPN не подключается из дома', 'ошибка авторизации VPN'],
  steps: ['Проверить интернет без VPN', 'Перезапустить клиент'],
  solution: 'Проверьте логин и сервер подключения.',
  category: 'network',
  score: 2,
});

const META = {
  modules: [],
  fields: [],
  dictionaries: [
    { dictionary: 'category', code: 'printer', label: 'Принтер и печать' },
    { dictionary: 'category', code: 'network', label: 'Сеть и связь' },
    { dictionary: 'building', code: 'A', label: 'Корпус А' },
  ],
  aiMode: 'stub',
  roles: ['engineer'],
  priorities: ['medium'],
} as MetaResponse;

describe('articleRows', () => {
  it('строит строки списка: заголовок, категория, симптомы, score', () => {
    const rows = articleRows([article(), SECOND], 'принтер не печатает', categoryLabels(META));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe('kb-print-red');
    expect(row?.title).toBe('Принтер мигает красным индикатором');
    expect(row?.category).toBe('printer');
    expect(row?.categoryLabel).toBe('Принтер и печать');
    expect(row?.symptoms).toBe('принтер не печатает · красный индикатор');
    expect(row?.scoreLabel).toBe('3');
  });

  it('пустой запрос отдаёт всю выдачу сервера в исходном порядке', () => {
    const rows = articleRows([SECOND, article()], '', categoryLabels(META));

    expect(rows.map((row) => row.id)).toEqual(['kb-network-vpn', 'kb-print-red']);
  });

  it('показывает выдачу сервера, если локальные слова не совпали', () => {
    // Сервер ищет по стемам и полнотекстовому индексу: локальная проверка не должна прятать статьи.
    const rows = articleRows([article()], 'картридж');

    expect(rows).toHaveLength(1);
  });

  it('битый ответ не роняет экран: пустые и неполные записи пропускаются', () => {
    const broken = [
      null,
      undefined,
      'не статья',
      { title: 'без id' },
      { id: 'kb-no-title' },
      { id: 'kb-partial', title: 'Частичная статья', symptoms: [1, 'симптом'], steps: null, category: 7 },
    ];

    const rows = articleRows(broken as unknown[]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('kb-partial');
    expect(rows[0]?.symptoms).toBe('симптом');
    expect(rows[0]?.article.steps).toEqual([]);
    expect(rows[0]?.article.category).toBeNull();
    expect(rows[0]?.scoreLabel).toBeNull();
  });

  it('нет ответа — пустой список, а не падение', () => {
    expect(articleRows(null)).toEqual([]);
    expect(articleRows(undefined)).toEqual([]);
    expect(articleRows([])).toEqual([]);
  });
});

describe('filterArticles', () => {
  it('оставляет статьи с совпадением по началу слова', () => {
    const result = filterArticles([article(), SECOND], 'VPN подключ');

    expect(result.map((item) => item.id)).toEqual(['kb-network-vpn']);
  });

  it('сортирует по числу совпавших слов', () => {
    const result = filterArticles([article(), SECOND], 'принтер картридж красный');

    expect(result[0]?.id).toBe('kb-print-red');
  });

  it('нет совпадений — пустой список', () => {
    expect(filterArticles([article(), SECOND], 'сканер штрихкод')).toEqual([]);
  });

  it('битые записи и служебные слова запроса игнорируются', () => {
    expect(filterArticles([null, 'текст'], 'что это')).toEqual([]);
  });
});

describe('normalizeArticle и оценка', () => {
  it('нормализует статью и не выдумывает отсутствующие поля', () => {
    const normalized = normalizeArticle({
      id: '  kb-1 ',
      title: ' Заголовок ',
      symptoms: [' симптом '],
      steps: [' шаг '],
      solution: ' решение ',
      category: 'printer',
      score: 0.4237,
    });

    expect(normalized).toEqual({
      id: 'kb-1',
      title: 'Заголовок',
      symptoms: ['симптом'],
      steps: ['шаг'],
      solution: 'решение',
      category: 'printer',
      score: 0.4237,
    });
  });

  it('пустой id или заголовок — не статья', () => {
    expect(normalizeArticle({ id: '', title: 'Есть' })).toBeNull();
    expect(normalizeArticle({ id: 'kb-1', title: '   ' })).toBeNull();
    expect(normalizeArticle(42)).toBeNull();
  });

  it('оценка: целое как есть, дробь с запятой', () => {
    expect(formatScore(3)).toBe('3');
    expect(formatScore(0.4237)).toBe('0,42');
    expect(formatScore(undefined)).toBeNull();
    expect(formatScore(Number.NaN)).toBeNull();
  });
});

describe('sourceLinks', () => {
  it('оставляет id и заголовок, убирает дубли', () => {
    const links = sourceLinks([
      { id: 'kb-1', title: 'Первая' },
      { id: 'kb-1', title: 'Первая снова' },
      { id: 'kb-2', title: 'Вторая' },
    ]);

    expect(links).toEqual([
      { id: 'kb-1', title: 'Первая' },
      { id: 'kb-2', title: 'Вторая' },
    ]);
  });

  it('битые ссылки и пустой ответ — пустой список', () => {
    expect(sourceLinks([null, { id: '' }, { title: 'без id' }, 'строка'])).toEqual([]);
    expect(sourceLinks(null)).toEqual([]);
    expect(sourceLinks(undefined)).toEqual([]);
  });
});

describe('askModeLabel', () => {
  it('шаблонный ответ помечается честно', () => {
    expect(askModeLabel('template')).toBe('ответ по статьям без модели');
    expect(askModeLabel('agent')).toBe('ответ агента по статьям');
    expect(askModeLabel(undefined)).toBe('ответ базы знаний');
    expect(askModeLabel('нечто')).toBe('ответ базы знаний');
  });
});

describe('stepsDone', () => {
  it('считает отмеченные шаги и подпись', () => {
    const progress = stepsDone(['а', 'б', 'в'], new Set([0, 2]));

    expect(progress).toEqual({ done: 2, total: 3, label: 'выполнено 2 из 3' });
  });

  it('битые и лишние индексы не ломают счётчик', () => {
    const progress = stepsDone(['а'], new Set([0, 5, -1, 1.5]));

    expect(progress.done).toBe(1);
    expect(progress.total).toBe(1);
  });

  it('пустые шаги — ноль из нуля', () => {
    expect(stepsDone([], new Set())).toEqual({ done: 0, total: 0, label: 'выполнено 0 из 0' });
    expect(stepsDone(null, null)).toEqual({ done: 0, total: 0, label: 'выполнено 0 из 0' });
  });

  it('ключ отметки — статья и номер шага', () => {
    expect(stepKey('kb-1', 2)).toBe('kb-1:2');
  });
});

describe('articleStats', () => {
  it('без статистики в ответе API блока нет', () => {
    expect(articleStats(article())).toBeNull();
    expect(articleStats(null)).toBeNull();
  });

  it('если API отдаст helped/total — подпись «помогла N из M»', () => {
    const stats = articleStats(article({ stats: { helped: 9, total: 11 } }));

    expect(stats).toEqual({ helped: 9, total: 11, label: 'помогла 9 из 11' });
  });

  it('битая статистика не рисуется', () => {
    expect(articleStats(article({ stats: { helped: 12, total: 11 } }))).toBeNull();
    expect(articleStats(article({ stats: { helped: 0, total: 0 } }))).toBeNull();
  });
});

describe('подписи', () => {
  it('категория из справочника, иначе код, иначе «без категории»', () => {
    const labels = categoryLabels(META);

    expect(labels).toEqual({ printer: 'Принтер и печать', network: 'Сеть и связь' });
    expect(categoryName('printer', labels)).toBe('Принтер и печать');
    expect(categoryName('unknown', labels)).toBe('unknown');
    expect(categoryName(null, labels)).toBe('без категории');
  });

  it('русское склонение по числу', () => {
    expect(pluralRu(1, 'статья', 'статьи', 'статей')).toBe('статья');
    expect(pluralRu(3, 'статья', 'статьи', 'статей')).toBe('статьи');
    expect(pluralRu(11, 'статья', 'статьи', 'статей')).toBe('статей');
    expect(pluralRu(21, 'статья', 'статьи', 'статей')).toBe('статья');
  });

  it('слова запроса без служебных и коротких', () => {
    expect(queryWords('Что это: принтер жуёт бумагу?')).toEqual(['принтер', 'жуёт', 'бумагу']);
  });
});

describe('articleSummary и дубли', () => {
  it('суть — первая фраза решения', () => {
    expect(articleSummary(article({ solution: 'Проверить лоток. Затем картридж.' }))).toBe('Проверить лоток');
  });

  it('без решения берём симптомы', () => {
    expect(articleSummary(article({ solution: '', symptoms: ['не печатает', 'мигает'] }))).toBe(
      'не печатает · мигает',
    );
  });

  it('длинное обрезается по слову с многоточием', () => {
    const long = 'слово '.repeat(40);
    const summary = articleSummary(article({ solution: long }), 40);

    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(41);
  });

  it('одинаковые статьи по заголовку не дублируются', () => {
    const list = dedupeArticles([
      article({ id: 'kb-1', title: 'Один и тот же' }),
      article({ id: 'kb-2', title: 'один и тот же' }),
      article({ id: 'kb-3', title: 'Другой' }),
    ]);

    expect(list.map((item) => item.id)).toEqual(['kb-1', 'kb-3']);
  });

  it('строки списка получают суть и подпись статистики, если она есть', () => {
    const rows = articleRows([article({ stats: { helped: 9, total: 11 } })]);

    expect(rows[0]?.helpLabel).toBe('помогла 9 из 11');
    expect(rows[0]?.summary).toBe('Обычно помогает замена картриджа или перезапуск устройства');
  });
});

describe('похожие заявки', () => {
  function similar(overrides: Partial<SimilarTicket> = {}): SimilarTicket {
    return {
      ticketId: 'ticket-1',
      number: 'З-1',
      status: 'closed',
      title: 'принтер не печатает',
      score: 1,
      ...overrides,
    };
  }

  it('одинаковые формулировки собираются в одну строку со счётчиком', () => {
    const groups = relatedGroups([
      similar(),
      similar({ ticketId: 'ticket-2', number: 'З-2' }),
      similar({ ticketId: 'ticket-3', title: 'нет сети' }),
    ]);

    expect(groups).toEqual([
      { title: 'принтер не печатает', count: 2, number: 'З-2' },
      { title: 'нет сети', count: 1, number: 'З-1' },
    ]);
  });

  it('отменённые заявки решением не считаются', () => {
    const groups = relatedGroups([similar({ status: 'cancelled' }), similar({ ticketId: 'ticket-2' })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });

  it('пустой ответ — пустой список', () => {
    expect(relatedGroups([])).toEqual([]);
  });
});

describe('активные задачи инженера', () => {
  function ticket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 't-1',
      number: 'З-1',
      appealId: 'a-1',
      status: 'assigned',
      priority: 'medium',
      category: 'printer',
      departmentId: null,
      assigneeId: 'u-engineer',
      isEmergency: false,
      incidentId: null,
      reactDueAt: null,
      slaDueAt: null,
      equipmentId: null,
      locationId: null,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: '2026-11-14T08:00:00.000Z',
      updatedAt: '2026-11-14T08:00:00.000Z',
      ...overrides,
    };
  }

  it('оставляет назначенные и взятые в работу', () => {
    const list = activeTasks(
      [
        ticket(),
        ticket({ id: 't-2', status: 'in_progress' }),
        ticket({ id: 't-3', status: 'resolved' }),
        ticket({ id: 't-4', assigneeId: 'u-other' }),
      ],
      'u-engineer',
    );

    expect(list.map((item) => item.id)).toEqual(['t-1', 't-2']);
  });
});

describe('черновик статьи из решений', () => {
  it('собирает шаги статей без дублей и решения заявок', () => {
    const draft = buildDraft({
      query: 'VPN не подключается',
      articles: [
        article({ id: 'kb-vpn', title: 'VPN: подключение', steps: ['Проверить интернет', 'Перезапустить клиент'] }),
        article({ id: 'kb-2', title: 'VPN: сеть', steps: ['Проверить интернет', 'Проверить сервер'] }),
      ],
      tickets: [
        {
          ticketId: 'ticket-1',
          number: 'З-1',
          status: 'closed',
          title: 'VPN не подключается из дома',
          score: 1,
        },
      ],
      resolutions: [
        { number: 'З-1', text: 'Перевыпущен сертификат' },
        { number: 'З-2', text: '  ' },
      ],
    });

    expect(draft.title).toBe('VPN не подключается');
    expect(draft.steps.map((step) => step.text)).toEqual([
      'Проверить интернет',
      'Перезапустить клиент',
      'Проверить сервер',
    ]);
    expect(draft.steps[0]?.articleTitle).toBe('VPN: подключение');
    expect(draft.solutions).toEqual([{ number: 'З-1', text: 'Перевыпущен сертификат' }]);
    expect(draft.symptoms).toEqual(['VPN не подключается из дома']);
    expect(draft.empty).toBe(false);
  });

  it('без источников черновик честно пустой', () => {
    const draft = buildDraft({ query: 'wi-fi', articles: [], tickets: [] });

    expect(draft.empty).toBe(true);
    expect(draft.steps).toEqual([]);
    expect(draft.solutions).toEqual([]);
  });

  it('заголовок берётся из статьи, если запрос пустой', () => {
    const draft = buildDraft({ query: '  ', articles: [article()], tickets: [] });

    expect(draft.title).toBe('Принтер мигает красным индикатором');
  });
});
