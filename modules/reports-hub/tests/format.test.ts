import { describe, expect, it } from 'vitest';
import {
  REPORTS,
  csvUrl,
  errorMessage,
  findReport,
  formatMetric,
  formatShiftDate,
  insightActions,
  insightText,
  insightView,
  isKnownReportPayload,
  isReportError,
  numberRows,
  reportFacts,
  reportIsEmpty,
  reportTable,
  runBody,
  formatAnswer,
  hotspotFocus,
  plural,
  summaryAnswer,
  summaryUrl,
  todayIso,
} from '../web/format';

/**
 * Примеры ответов `POST /api/m/<id>/run` повторяют схемы серверных модулей
 * (`HotspotsRun`, `ShiftRun`, `SlaRun`, `WorkloadRun`, `AiEffectRun`, `KbGapsRun`, `EmergencyRun`).
 */

const period = { from: '2026-10-16', to: '2026-11-14', days: 30 };

const hotspotsRun = {
  report: {
    period,
    previousPeriod: { from: '2026-09-16', to: '2026-10-15', days: 30 },
    filters: {},
    total: 600,
    previousTotal: 552,
    trendPercent: 8.7,
    repeatedTickets: 42,
    rows: [
      {
        key: 'eq:eq-b312',
        kind: 'equipment',
        equipmentId: 'eq-b312',
        label: 'HP LaserJet Pro M404dn',
        building: 'Б',
        cabinet: '312',
        category: 'printer',
        count: 7,
        sharePercent: 1.2,
        avgResolutionMinutes: 95,
        previousCount: 4,
        trendPercent: 75,
      },
      {
        key: 'cab:Б:314',
        kind: 'cabinet',
        equipmentId: null,
        label: 'Кабинет 314',
        building: 'Б',
        cabinet: '314',
        category: null,
        count: 5,
        sharePercent: 0.8,
        avgResolutionMinutes: null,
        previousCount: 5,
        trendPercent: 0,
      },
    ],
  },
  facts: [
    { label: 'Период, дней', value: 30 },
    { label: 'Заявок за период', value: 600 },
    { label: 'Главная точка', value: 'HP LaserJet Pro M404dn — 7' },
  ],
  insight: {
    meaning: 'Принтер в кабинете 312 снова в топе: 7 заявок за месяц.',
    actions: ['Заменить принтер в каб. 312', 'Проверить картриджи на складе'],
    source: 'ai',
    model: 'openai/gpt-4o-mini',
  },
};

const shiftRun = {
  report: {
    period: {
      date: '2026-11-14',
      from: '2026-11-14T00:00:00.000Z',
      to: '2026-11-14T23:59:59.999Z',
    },
    totals: {
      total: 47,
      created: 12,
      closed: 31,
      emergency: 1,
      slaBreaches: 2,
      slaOnTimePercent: 93.5,
    },
    byAssignee: [
      {
        assigneeId: 'u-engineer-2',
        name: 'Петров',
        total: 11,
        open: 6,
        closed: 5,
        avgResolutionMinutes: 128,
      },
    ],
    attention: { overdue: [], overdueCount: 0, waitingReview: [], waitingReviewCount: 0 },
  },
  facts: [
    { label: 'Всего за смену', value: 47 },
    { label: 'Аварии', value: 1 },
  ],
  insight: {
    meaning: '47 заявок за смену, одна авария и 2 заявки под угрозой просрочки.',
    actions: ['Разобрать 2 просроченные заявки до конца дня'],
    source: 'template',
    model: null,
  },
};

const slaRun = {
  report: {
    period,
    filters: {},
    summary: {
      total: 600,
      closed: 520,
      open: 68,
      cancelled: 12,
      dueKnown: 500,
      onTimeClosed: 460,
      lateClosed: 40,
      openOverdue: 5,
      atRisk: 3,
      slaOnTimePercent: 92,
      reactionKnown: 480,
      reactionMeasured: 500,
      reactionOnTime: 470,
      reactionBreaches: 30,
      reactionOnTimePercent: 94,
      avgReactionMinutes: 22,
      avgResolutionMinutes: 180,
      avgLateMinutes: 240,
    },
    byPriority: [],
    byDepartment: [
      {
        departmentId: 'dep-it',
        label: 'ИТ',
        total: 30,
        closed: 24,
        lateClosed: 3,
        openOverdue: 1,
        breaches: 4,
        onTimePercent: 87.5,
        avgResolutionMinutes: 210,
      },
    ],
    worst: [],
  },
  facts: [
    { label: 'В срок, %', value: 92 },
    { label: 'Нарушений', value: 45 },
  ],
  insight: {
    meaning: '92% закрыты в срок; чаще опаздываем по категории «ПО» ночью.',
    actions: ['Назначить дежурного по ПО на ночь'],
    source: 'ai',
    model: 'openai/gpt-4o-mini',
  },
};

const workloadRun = {
  report: {
    period,
    filters: {},
    summary: {
      totalOpen: 18,
      totalClosed: 64,
      engineers: 5,
      overloaded: 1,
      avgOpenPerEngineer: 3.6,
      avgResolutionMinutes: 120,
      overloadThreshold: 5,
    },
    byEngineer: [
      {
        assigneeId: 'u-engineer-2',
        name: 'Петров',
        departmentId: 'dep-it',
        departmentLabel: 'ИТ',
        open: 11,
        closed: 8,
        total: 19,
        avgResolutionMinutes: 95,
        overload: true,
      },
    ],
    byDepartment: [],
  },
  facts: [
    { label: 'Открыто', value: 18 },
    { label: 'Перегружены', value: 1 },
  ],
  insight: {
    meaning: 'У Петрова 11 открытых заявок — вдвое больше среднего.',
    actions: ['Перераспределить сетевые заявки на Сидорова'],
    source: 'template',
    model: null,
  },
};

const aiEffectRun = {
  report: {
    period,
    totals: {
      ticketsWithAi: 120,
      fieldsSuggested: 460,
      fieldsCorrected: 41,
      ticketsWithoutEdits: 96,
      shareWithoutEditsPercent: 80,
      avgCorrectionsPerTicket: 0.34,
      avgMinutesToConfirm: 6.5,
      confirmedTickets: 110,
      correctionsByField: [
        {
          fieldKey: 'departmentId',
          label: 'Подразделение',
          corrections: 14,
          suggestions: 120,
        },
      ],
    },
    comparison: {
      withAi: { tickets: 110, avgMinutesToConfirm: 6.5 },
      withoutAi: null,
      source: 'measurements',
      note: 'Замеров ручного режима нет.',
    },
  },
  facts: [
    { label: 'Полей предложено', value: 460 },
    { label: 'Полей исправлено', value: 41 },
  ],
  insight: {
    meaning: 'ИИ заполнил 460 полей, диспетчер исправил 41.',
    actions: ['Проверить подсказки поля «Подразделение»'],
    source: 'ai',
    model: 'openai/gpt-4o-mini',
  },
};

const kbGapsRun = {
  report: {
    period,
    filters: {},
    summary: {
      total: 600,
      analyzed: 480,
      withArticle: 420,
      withoutArticle: 60,
      shareWithoutArticlePercent: 10,
      themes: 5,
      fromJournal: 40,
      fromKnowledgeBase: 20,
    },
    themes: [
      {
        key: 'theme:vpn',
        label: 'VPN не подключается',
        symptom: 'VPN не подключается',
        category: 'network',
        categoryLabel: 'Сеть',
        count: 23,
        sharePercent: 31.5,
        exampleTicketId: 't-1001',
        exampleNumber: 'З-1001',
      },
    ],
    byCategory: [],
  },
  facts: [
    { label: 'Без статьи', value: 60 },
    { label: 'Тем', value: 5 },
  ],
  insight: {
    meaning: 'Проблема «VPN не подключается» — 23 заявки, статьи нет.',
    actions: ['Написать статью про VPN'],
    source: 'template',
    model: null,
  },
};

const emergencyRun = {
  report: {
    period,
    filters: {},
    summary: {
      total: 600,
      emergency: 16,
      sharePercent: 2.7,
      closed: 14,
      open: 2,
      reactionMeasured: 12,
      avgReactionMinutes: 8,
      repeatedHotspots: 2,
      detectedSignals: 20,
      suspectedSignals: 4,
      falseAlarms: 4,
    },
    hotspots: [
      {
        key: 'eq:eq-sw-1',
        kind: 'equipment',
        equipmentId: 'eq-sw-1',
        locationId: null,
        label: 'Коммутатор D-Link',
        count: 3,
        sharePercent: 18.75,
        lastAt: '2026-11-12T09:30:00.000Z',
      },
    ],
    recent: [],
  },
  facts: [
    { label: 'Аварий', value: 16 },
    { label: 'Ложных тревог', value: 4 },
  ],
  insight: {
    meaning: '16 аварий, средняя реакция 8 минут.',
    actions: ['Проверить коммутатор в корпусе А'],
    source: 'ai',
    model: 'openai/gpt-4o-mini',
  },
};

describe('REPORTS и маршруты', () => {
  it('перечисляет О1–О7 в порядке брифа', () => {
    expect(REPORTS.map((report) => report.code)).toEqual(['О1', 'О2', 'О3', 'О4', 'О5', 'О6', 'О7']);
    expect(REPORTS.map((report) => report.id)).toEqual([
      'report-shift',
      'report-hotspots',
      'report-sla',
      'report-workload',
      'report-ai-effect',
      'report-kb-gaps',
      'report-emergency',
    ]);
  });

  it('строит тело run: дата у смены, дни у остальных', () => {
    expect(runBody(REPORTS[0]!, 30, '2026-11-14')).toEqual({ date: '2026-11-14' });
    expect(runBody(REPORTS[1]!, 30, '2026-11-14')).toEqual({ days: 30 });
  });

  it('собирает ссылку CSV за тот же период', () => {
    expect(csvUrl('report-hotspots', 30)).toBe('/api/m/report-hotspots/export?format=csv&days=30');
    expect(csvUrl('report-shift', 30, '2026-11-14')).toBe(
      '/api/m/report-shift/export?format=csv&date=2026-11-14',
    );
    expect(csvUrl('report-sla', 7)).toBe('/api/m/report-sla/export?format=csv&days=7');
  });

  it('находит отчёт по id', () => {
    expect(findReport('report-sla')?.title).toBe('Сроки и SLA');
    expect(findReport('nope')).toBeUndefined();
  });

  it('форматирует дату смены и сегодняшний день', () => {
    expect(formatShiftDate('2026-11-14')).toBe('14.11.2026');
    expect(formatShiftDate('14.11')).toBe('—');
    expect(todayIso(new Date(2026, 10, 4))).toBe('2026-11-04');
  });
});

describe('таблицы отчётов', () => {
  it('О2: строки горячих точек и числа', () => {
    const table = reportTable(hotspotsRun);
    expect(table?.columns).toEqual(['Точка', 'Корпус', 'Заявок', 'Доля', 'Среднее решение']);
    expect(table?.rows[0]?.cells).toEqual(['HP LaserJet Pro M404dn', 'Б', '7', '1,2%', '1 ч 35 мин']);
    expect(table?.rows[1]?.cells[4]).toBe('—');
    expect(numberRows(hotspotsRun)).toBe(2);
  });

  it('О1: строки исполнителей смены', () => {
    const table = reportTable(shiftRun);
    expect(table?.columns[0]).toBe('Исполнитель');
    expect(table?.rows[0]?.cells).toEqual(['Петров', '11', '6', '5', '2 ч 8 мин']);
    expect(numberRows(shiftRun)).toBe(1);
  });

  it('О3: подразделения и доля в срок', () => {
    const table = reportTable(slaRun);
    expect(table?.columns).toEqual(['Подразделение', 'Всего', 'Нарушений', 'В срок', 'Среднее решение']);
    expect(table?.rows[0]?.cells).toEqual(['ИТ', '30', '4', '87,5%', '3 ч 30 мин']);
  });

  it('О4: нагрузка инженеров', () => {
    const table = reportTable(workloadRun);
    expect(table?.rows[0]?.cells).toEqual(['Петров', 'ИТ', '11', '8', '1 ч 35 мин']);
  });

  it('О5: правки по полям', () => {
    const table = reportTable(aiEffectRun);
    expect(table?.columns).toEqual(['Поле', 'Подсказок', 'Исправлений']);
    expect(table?.rows[0]?.cells).toEqual(['Подразделение', '120', '14']);
  });

  it('О6: темы без статьи', () => {
    const table = reportTable(kbGapsRun);
    expect(table?.rows[0]?.cells).toEqual(['VPN не подключается', 'Сеть', '23', '31,5%', 'З-1001']);
  });

  it('О7: аварийные точки и дата последней', () => {
    const table = reportTable(emergencyRun);
    expect(table?.rows[0]?.cells).toEqual(['Коммутатор D-Link', 'техника', '3', '18,8%', '12.11']);
  });

  it('пустой отчёт: таблица есть, строк нет', () => {
    const empty = {
      report: { ...hotspotsRun.report, total: 0, rows: [] },
      facts: [],
      insight: { meaning: 'За период заявок нет.', actions: [], source: 'template', model: null },
    };
    expect(reportTable(empty)?.rows).toEqual([]);
    expect(numberRows(empty)).toBe(0);
    expect(reportIsEmpty(empty)).toBe(true);
    expect(reportIsEmpty(hotspotsRun)).toBe(false);
  });

  it('незнакомый формат не падает', () => {
    expect(reportTable(null)).toBeNull();
    expect(reportTable('oops')).toBeNull();
    expect(reportTable({ message: 'boom' })).toBeNull();
    expect(numberRows({ report: { rows: 'нет' } })).toBe(0);
    expect(isKnownReportPayload({ message: 'boom' })).toBe(false);
    expect(isKnownReportPayload({ report: { custom: true }, facts: [] })).toBe(true);
    expect(reportTable({ report: { custom: true }, facts: [] })).toBeNull();
  });
});

describe('выводы и показатели', () => {
  it('читает insight и форматирует facts, пропуская период', () => {
    expect(insightText(hotspotsRun)).toBe('Принтер в кабинете 312 снова в топе: 7 заявок за месяц.');
    expect(insightActions(hotspotsRun)).toHaveLength(2);
    expect(insightView(hotspotsRun).source).toBe('ai');
    expect(insightView(hotspotsRun).model).toBe('openai/gpt-4o-mini');
    expect(reportFacts(hotspotsRun)).toEqual([
      { label: 'Заявок за период', value: '600' },
      { label: 'Главная точка', value: 'HP LaserJet Pro M404dn — 7' },
    ]);
    expect(reportFacts({ report: {}, facts: [{ label: 'Период, дней', value: 30 }] })).toEqual([]);
  });

  it('поддерживает insights как запасной формат вывода', () => {
    const payload = {
      report: { rows: [] },
      insights: ['Проблема в сети корпуса А.', 'Проверить коммутатор.'],
    };
    expect(insightText(payload)).toBe('Проблема в сети корпуса А.');
    expect(insightActions(payload)).toEqual(['Проверить коммутатор.']);
    expect(insightView({ insight: 'Короткий вывод' }).meaning).toBe('Короткий вывод');
    expect(insightText({ report: {} })).toBeNull();
  });

  it('форматирует показатели', () => {
    expect(formatMetric(1284)).toBe('1\u00A0284');
    expect(formatMetric(0)).toBe('0');
    expect(formatMetric(-600)).toBe('−600');
    expect(formatMetric(12.5)).toBe('12,5');
    expect(formatMetric(null)).toBe('—');
    expect(formatMetric('')).toBe('—');
    expect(formatMetric('92%')).toBe('92%');
    expect(formatMetric(undefined)).toBe('—');
  });
});

describe('ошибки сервера', () => {
  it('узнаёт ошибку в ответе с HTTP 200', () => {
    expect(isReportError({ error: 'Нет прав на отчёты' })).toBe(true);
    expect(errorMessage({ error: 'Нет прав на отчёты' })).toBe('Нет прав на отчёты');
    expect(isReportError({ ok: false, message: 'Модель недоступна' })).toBe(true);
    expect(errorMessage({ ok: false, message: 'Модель недоступна' })).toBe('Модель недоступна');
    expect(errorMessage({ error: { message: 'Таймаут модели' } })).toBe('Таймаут модели');
  });

  it('нормальный отчёт ошибкой не считает', () => {
    expect(isReportError(hotspotsRun)).toBe(false);
    expect(isReportError(null)).toBe(false);
    expect(isReportError('oops')).toBe(false);
    expect(errorMessage(null)).toBeNull();
  });
});

describe('карточки-ответы хаба отчётов', () => {
  it('строит адрес сводки без вызова ИИ и с косой чертой маршрута', () => {
    expect(summaryUrl(REPORTS[1]!, 30, '2026-11-14')).toBe('/api/m/report-hotspots/?days=30');
    expect(summaryUrl(REPORTS[0]!, 30, '2026-11-14')).toBe('/api/m/report-shift/?date=2026-11-14');
  });

  it('склоняет существительные по числу', () => {
    expect(plural(1, 'заявка', 'заявки', 'заявок')).toBe('заявка');
    expect(plural(2, 'заявка', 'заявки', 'заявок')).toBe('заявки');
    expect(plural(5, 'заявка', 'заявки', 'заявок')).toBe('заявок');
    expect(plural(11, 'заявка', 'заявки', 'заявок')).toBe('заявок');
    expect(plural(21, 'заявка', 'заявки', 'заявок')).toBe('заявка');
    expect(plural(23, 'заявка', 'заявки', 'заявок')).toBe('заявки');
  });

  it('форматирует ответ словами и числами', () => {
    expect(formatAnswer({ value: 48.2, unit: 'percent', caption: '', hint: null })).toBe('48,2%');
    expect(formatAnswer({ value: 19, unit: 'minutes', caption: '', hint: null })).toBe('19 мин');
    expect(formatAnswer({ value: 1284, unit: 'count', caption: '', hint: null })).toBe('1\u00A0284');
    expect(formatAnswer({ value: 'Кузнецов', unit: 'text', caption: '', hint: null })).toBe('Кузнецов');
  });

  it('О1: заявки смены и аварии', () => {
    expect(summaryAnswer('report-shift', shiftRun)).toEqual({
      value: 12,
      unit: 'count',
      caption: 'заявок за смену',
      hint: '1 авария',
    });
  });

  it('О3: доля в срок и просрочки', () => {
    expect(summaryAnswer('report-sla', slaRun)).toEqual({
      value: 92,
      unit: 'percent',
      caption: 'закрыто в срок',
      hint: '5 просрочено · 3 под риском',
    });
  });

  it('О4: перегруженный инженер', () => {
    expect(summaryAnswer('report-workload', workloadRun)).toEqual({
      value: 'Петров',
      unit: 'text',
      caption: '11 из 5 задач',
      hint: '1 инженер перегружен',
    });
  });

  it('О4: перегруза нет — честно говорим «никто»', () => {
    const payload = {
      report: {
        ...workloadRun.report,
        summary: { ...workloadRun.report.summary, overloaded: 0 },
        byEngineer: [
          {
            assigneeId: null,
            name: 'Не назначено',
            departmentId: null,
            departmentLabel: '—',
            open: 9,
            closed: 0,
            total: 9,
            avgResolutionMinutes: null,
            overload: true,
          },
          {
            assigneeId: 'u-engineer-2',
            name: 'Артём Кузнецов',
            departmentId: 'dep-it',
            departmentLabel: 'ИТ',
            open: 2,
            closed: 1,
            total: 3,
            avgResolutionMinutes: 40,
            overload: false,
          },
        ],
      },
      facts: [],
      insight: { meaning: '', actions: [], source: 'template', model: null },
    };
    expect(summaryAnswer('report-workload', payload)).toEqual({
      value: 'Никто',
      unit: 'text',
      caption: 'перегруженных инженеров нет',
      hint: 'больше всех — Кузнецов, 2 задачи',
    });
  });

  it('О5: доля заявок без правок', () => {
    expect(summaryAnswer('report-ai-effect', aiEffectRun)).toEqual({
      value: 80,
      unit: 'percent',
      caption: 'заявок ИИ оформил без правок',
      hint: '7 мин до подтверждения',
    });
  });

  it('О6: самая частая тема без статьи', () => {
    expect(summaryAnswer('report-kb-gaps', kbGapsRun)).toEqual({
      value: 'VPN не подключается',
      unit: 'text',
      caption: '23 заявки без статьи',
      hint: null,
    });
  });

  it('О6: длинная тема обрезается по слову', () => {
    const payload = {
      report: {
        ...kbGapsRun.report,
        themes: [
          {
            ...kbGapsRun.report.themes[0],
            label: 'Компьютер не включается, индикатор питания мигает',
            count: 7,
          },
        ],
      },
      facts: [],
      insight: { meaning: '', actions: [], source: 'template', model: null },
    };
    const answer = summaryAnswer('report-kb-gaps', payload);
    expect(answer?.value).toBe('Компьютер не включается…');
    expect(answer?.caption).toBe('7 заявок без статьи');
  });

  it('О7: средняя реакция на аварию', () => {
    expect(summaryAnswer('report-emergency', emergencyRun)).toEqual({
      value: 8,
      unit: 'minutes',
      caption: 'средняя реакция на аварию',
      hint: '16 аварий за период',
    });
  });

  it('нет данных — нет ответа, карточка покажет пустое состояние', () => {
    expect(summaryAnswer('report-sla', { report: {} })).toBeNull();
    expect(summaryAnswer('report-sla', null)).toBeNull();
    expect(summaryAnswer('report-hotspots', hotspotsRun)).toBeNull();
    expect(summaryAnswer('nope', slaRun)).toBeNull();
  });

  it('О2: главная точка, причина и полоски', () => {
    const focus = hotspotFocus(hotspotsRun);
    expect(focus).not.toBeNull();
    expect(focus?.label).toBe('HP LaserJet Pro M404dn');
    expect(focus?.count).toBe(7);
    expect(focus?.caption).toBe('7 заявок за 30 дней');
    expect(focus?.trend).toBe('+75% к прошлому периоду');
    expect(focus?.repeated).toBe(42);
    expect(focus?.bars.map((bar) => [bar.label, bar.count, bar.width])).toEqual([
      ['HP LaserJet Pro M404dn', 7, 100],
      ['Кабинет 314', 5, 71],
    ]);
  });

  it('О2: повторных поломок нет — главного отчёта нет', () => {
    const single = {
      report: {
        ...hotspotsRun.report,
        rows: [{ ...hotspotsRun.report.rows[0], count: 1 }],
      },
      facts: [],
      insight: { meaning: '', actions: [], source: 'template', model: null },
    };
    expect(hotspotFocus(single)).toBeNull();
    expect(hotspotFocus({ report: {} })).toBeNull();
    expect(hotspotFocus('oops')).toBeNull();
  });

  it('О2: без сравнения тренд не выдумываем', () => {
    const noTrend = {
      report: {
        ...hotspotsRun.report,
        rows: [{ ...hotspotsRun.report.rows[0], trendPercent: null }],
      },
    };
    expect(hotspotFocus(noTrend)?.trend).toBeNull();
  });
});
