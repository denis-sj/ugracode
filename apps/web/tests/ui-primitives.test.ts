import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ActionCounterPill,
  DetailRow,
  EmptyState,
  InsightBlock,
  Modal,
  ProgressScale,
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
