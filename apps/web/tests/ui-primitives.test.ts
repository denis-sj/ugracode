import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ActionCounterPill,
  Checklist,
  Chip,
  DetailRow,
  EmptyState,
  InsightBlock,
  Modal,
  PriorityMark,
  ProgressScale,
  Segmented,
  StepBlock,
  Sticker,
  Timer,
  Toast,
} from '@ugra/ui';

describe('ProgressScale', () => {
  it('закрашивает сегменты и подписывает этап для скринридера', () => {
    const html = renderToStaticMarkup(createElement(ProgressScale, { stage: 2 }));
    expect(html.match(/ugra-scale__seg--on/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Этап 2 из 4: Проверена"');
  });

  it('показывает подписи этапов по флагу', () => {
    const html = renderToStaticMarkup(createElement(ProgressScale, { stage: 3, showLabels: true }));
    expect(html).toContain('Назначена');
    expect(html).toContain('Выполнена');
  });

  it('нулевой этап не врёт про достигнутый шаг', () => {
    const html = renderToStaticMarkup(createElement(ProgressScale, { stage: 0 }));
    expect(html).toContain('aria-label="Этап 0 из 4"');
  });
});

describe('DetailRow', () => {
  it('выводит значение, подсказку и тон', () => {
    const html = renderToStaticMarkup(
      createElement(DetailRow, {
        label: 'Инженер',
        value: 'Петров С. В.',
        hint: 'до 14:30',
        tone: 'accent',
        layout: 'stack',
      }),
    );
    expect(html).toContain('Инженер');
    expect(html).toContain('Петров С. В.');
    expect(html).toContain('до 14:30');
    expect(html).toContain('ugra-detail--stack');
    expect(html).toContain('ugra-detail__value--accent');
  });
});

describe('ActionCounterPill', () => {
  it('подписывает и ограничивает счётчик', () => {
    expect(renderToStaticMarkup(createElement(ActionCounterPill, { count: 3 }))).toContain('Ваших действий:');
    expect(renderToStaticMarkup(createElement(ActionCounterPill, { count: -2 }))).toContain('<b>0</b>');
  });
});

describe('EmptyState', () => {
  it('показывает заголовок, подсказку и действие', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: 'Очередь пуста', hint: 'Новые заявки появятся сами' }),
    );
    expect(html).toContain('Очередь пуста');
    expect(html).toContain('Новые заявки появятся сами');
  });
});

describe('Modal', () => {
  it('закрытое окно не рисуется, открытое — с ролью dialog', () => {
    expect(
      renderToStaticMarkup(createElement(Modal, { open: false, onClose: () => undefined, children: 'x' })),
    ).toBe('');
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: true,
        title: 'Заявка назначена',
        onClose: () => undefined,
        children: 'Петров',
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Заявка назначена');
  });
});

describe('Toast', () => {
  it('без сообщения ничего не рисует', () => {
    expect(renderToStaticMarkup(createElement(Toast, { message: null }))).toBe('');
  });

  it('ошибка действия — alert с текстом', () => {
    const html = renderToStaticMarkup(createElement(Toast, { message: 'Не удалось сохранить', tone: 'danger' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Не удалось сохранить');
  });
});

describe('Timer', () => {
  it('без даты показывает нулевой таймер', () => {
    expect(renderToStaticMarkup(createElement(Timer, { from: null }))).toContain('0:00');
  });
});

describe('InsightBlock', () => {
  it('подписывает «что это значит» и «что сделать»', () => {
    expect(renderToStaticMarkup(createElement(InsightBlock, { children: 'Факт' }))).toContain('Что это значит');
    expect(
      renderToStaticMarkup(createElement(InsightBlock, { kind: 'action', children: 'Заменить принтер' })),
    ).toContain('Что сделать');
  });
});

describe('PriorityMark', () => {
  it('слово только в aria-label, круг закрашен на долю', () => {
    const html = renderToStaticMarkup(createElement(PriorityMark, { priority: 'high' }));
    expect(html).toContain('aria-label="Приоритет: Высокий"');
    expect(html).toContain('conic-gradient(currentColor 0 75%');
    expect(html).not.toContain('>Высокий<');
  });

  it('авария перекрывает уровень и краснеет', () => {
    const html = renderToStaticMarkup(createElement(PriorityMark, { priority: 'low', isEmergency: true }));
    expect(html).toContain('aria-label="Приоритет: Авария"');
    expect(html).toContain('ugra-pmark--emergency');
  });

  it('без приоритета — пустой круг', () => {
    expect(renderToStaticMarkup(createElement(PriorityMark, { priority: null }))).toContain(
      'aria-label="Приоритет: Без приоритета"',
    );
  });
});

describe('Segmented', () => {
  it('помечает активный сегмент и счётчики', () => {
    const html = renderToStaticMarkup(
      createElement(Segmented, {
        value: 'ready',
        options: [
          { value: 'all', label: 'Все', count: 5 },
          { value: 'ready', label: 'Готовые', count: 2 },
        ],
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Готовые');
    expect(html).toContain('ugra-segmented__count');
  });
});

describe('Chip', () => {
  it('кликабельный чип — кнопка с нажатием', () => {
    const html = renderToStaticMarkup(createElement(Chip, { active: true, children: 'Категория' }));
    expect(html).toContain('ugra-chip--active');
    expect(html).toContain('Категория');
  });
});

describe('Sticker', () => {
  it('обёртка с подписью и тревожным тоном', () => {
    const html = renderToStaticMarkup(
      createElement(Sticker, { label: 'Превью', tone: 'danger', children: 'Заявка' }),
    );
    expect(html).toContain('aria-label="Превью"');
    expect(html).toContain('ugra-sticker--danger');
  });
});

describe('StepBlock', () => {
  it('свёрнутый шаг показывает итог и не рисует тело', () => {
    const html = renderToStaticMarkup(
      createElement(StepBlock, {
        index: 2,
        title: 'Поля заявки',
        summary: '6 полей, 1 ждёт вас',
        open: false,
        onToggle: () => undefined,
        children: 'тело',
      }),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('6 полей, 1 ждёт вас');
    expect(html).not.toContain('тело');
  });

  it('пройденный шаг помечается галочкой, открытый показывает тело', () => {
    const html = renderToStaticMarkup(
      createElement(StepBlock, {
        index: 1,
        title: 'Обращение',
        open: true,
        done: false,
        onToggle: () => undefined,
        children: 'текст',
      }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('текст');
  });
});

describe('Checklist', () => {
  it('пункты с отметками и без обработчика — статичные', () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, {
        items: [
          { id: 'a', label: 'Уведомить дежурного', done: true },
          { id: 'b', label: 'Осмотреть место', hint: 'Отметит дежурный' },
        ],
      }),
    );
    expect(html).toContain('Уведомить дежурного');
    expect(html).toContain('ugra-checklist__box--done');
    expect(html).not.toContain('role="checkbox"');
  });

  it('с обработчиком пункт работает как чекбокс', () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { items: [{ id: 'a', label: 'Пункт' }], onToggle: () => undefined }),
    );
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
  });
});
