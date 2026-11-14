import { describe, expect, it } from 'vitest';
import type { WebModule, WidgetDef } from '@ugra/core/web';
import { hasTicketWidget, ticketWidgets } from '../web/ticket-slots';

function widget(patch: Partial<WidgetDef> & { id: string }): WidgetDef {
  return {
    slot: 'ticket.footer',
    order: 10,
    roles: [],
    component: null,
    ...patch,
  };
}

function moduleOf(id: string, widgets: WidgetDef[]): WebModule {
  return { id, pages: [], widgets, chatCards: [], reportViews: [] };
}

describe('слоты карточки заявки: отбор виджетов', () => {
  it('берёт только слоты заявки, сохраняя порядок модулей', () => {
    const widgets = ticketWidgets([
      moduleOf('one', [widget({ id: 'banner', slot: 'ticket.banner' }), widget({ id: 'other', slot: 'dashboard.tiles' })]),
      moduleOf('two', [widget({ id: 'footer' })]),
    ]);

    expect(widgets.map((item) => item.id)).toEqual(['banner', 'footer']);
  });

  it('берёт настоящие слоты emergency и applicant-feedback', () => {
    const widgets = ticketWidgets([
      moduleOf('applicant-feedback', [widget({ id: 'applicant-feedback.reply' })]),
      moduleOf('emergency', [widget({ id: 'emergency.banner', slot: 'ticket.banner' })]),
    ]);

    expect(widgets.map((item) => item.id)).toEqual(['applicant-feedback.reply', 'emergency.banner']);
  });

  it('пустой реестр — пустой список', () => {
    expect(ticketWidgets([])).toEqual([]);
    expect(ticketWidgets([moduleOf('empty', [])])).toEqual([]);
  });
});

describe('слоты карточки заявки: роли', () => {
  const widgets = [
    widget({ id: 'banner', slot: 'ticket.banner', roles: ['dispatcher', 'admin'] }),
    widget({ id: 'footer', roles: ['dispatcher'] }),
    widget({ id: 'common', roles: [] }),
  ];

  it('виджет без ролей доступен всем', () => {
    expect(hasTicketWidget(widgets, 'ticket.footer', 'engineer')).toBe(true);
  });

  it('виджет с ролями — только своим ролям', () => {
    expect(hasTicketWidget([widgets[0]!], 'ticket.banner', 'dispatcher')).toBe(true);
    expect(hasTicketWidget([widgets[0]!], 'ticket.banner', 'admin')).toBe(true);
    expect(hasTicketWidget([widgets[1]!], 'ticket.footer', 'dispatcher')).toBe(true);
    expect(hasTicketWidget([widgets[1]!], 'ticket.footer', 'engineer')).toBe(false);
    expect(hasTicketWidget([widgets[1]!], 'ticket.banner', 'dispatcher')).toBe(false);
  });

  it('без роли проверяется только слот, пустой список — false', () => {
    expect(hasTicketWidget([widgets[1]!], 'ticket.footer')).toBe(true);
    expect(hasTicketWidget([], 'ticket.banner', 'dispatcher')).toBe(false);
  });
});
