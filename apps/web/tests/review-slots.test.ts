import type { User } from '@ugra/contracts';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlotWidget } from '@ugra/ui';
import { Slot } from '@ugra/ui';

/**
 * SSR-проверка слотов карточки заявки (`ticket.banner`, `ticket.footer`).
 *
 * `TicketSlot` из `modules/dispatcher-review/web/TicketSlot.tsx` — тонкая обёртка над `Slot`
 * из `@ugra/ui`: передаёт имя слота, роль пользователя и контекст `{ ticketId, api, user }`.
 * Здесь проверяем ровно этот контракт на тех же пропсах, чтобы разметка слотов не падала.
 */

const DISPATCHER: User = {
  id: 'u-dispatcher',
  fullName: 'Анна Миронова',
  role: 'dispatcher',
  departmentId: 'dep-support',
  position: 'Диспетчер',
};

const APPLICANT: User = {
  ...DISPATCHER,
  id: 'u-applicant',
  fullName: 'Иван Заявителев',
  role: 'applicant',
};

function BannerProbe(props: Record<string, unknown>): ReactElement {
  const user = props.user as User;
  return createElement(
    'div',
    { 'data-probe': 'banner' },
    `${String(props.ticketId)}|${user.role}|${props.api === undefined ? 'no-api' : 'api'}`,
  );
}

function footerProbe(label: string): (props: Record<string, unknown>) => ReactElement {
  return (props) => createElement('div', { 'data-probe': 'footer' }, `${label}|${String(props.ticketId)}`);
}

const WIDGETS: SlotWidget[] = [
  { slot: 'ticket.footer', id: 'footer.second', order: 20, roles: [], component: footerProbe('second') },
  { slot: 'ticket.footer', id: 'footer.first', order: 10, roles: ['dispatcher'], component: footerProbe('first') },
  { slot: 'ticket.banner', id: 'banner.one', order: 5, roles: ['dispatcher', 'admin'], component: BannerProbe },
  { slot: 'dashboard.tiles', id: 'other.slot', order: 0, roles: [], component: BannerProbe },
];

function renderSlot(name: string, user: User): string {
  return renderToStaticMarkup(
    createElement(Slot, {
      name,
      widgets: WIDGETS,
      role: user.role,
      context: { ticketId: 't-42', api: undefined, user, trackAction: undefined },
    }),
  );
}

describe('слоты карточки заявки: SSR-разметка', () => {
  it('рисует виджеты своего слота по порядку и передаёт ticketId и роль', () => {
    const markup = renderSlot('ticket.footer', DISPATCHER);

    expect(markup.match(/data-probe="footer"/g)).toHaveLength(2);
    expect(markup.match(/t-42/g)).toHaveLength(2);
    expect(markup).not.toContain('data-probe="banner"');
    expect(markup.indexOf('first|t-42')).toBeLessThan(markup.indexOf('second|t-42'));
  });

  it('плашка заявки получает контекст и не смешивается с подвалом', () => {
    const markup = renderSlot('ticket.banner', DISPATCHER);

    expect(markup).toContain('t-42|dispatcher|no-api');
    expect(markup).not.toContain('data-probe="footer"');
  });

  it('чужие роли не видят виджет, виджет без ролей видят все', () => {
    const markup = renderSlot('ticket.footer', APPLICANT);

    expect(markup.match(/data-probe="footer"/g)).toHaveLength(1);
    expect(markup).toContain('t-42');
  });

  it('без виджетов слот пустой и не падает', () => {
    expect(
      renderToStaticMarkup(
        createElement(Slot, {
          name: 'ticket.banner',
          widgets: [],
          role: DISPATCHER.role,
          context: { ticketId: 't-1', user: DISPATCHER },
        }),
      ),
    ).toBe('');
  });

  it('виджет без компонента не роняет слот', () => {
    const markup = renderToStaticMarkup(
      createElement(Slot, {
        name: 'ticket.banner',
        widgets: [{ slot: 'ticket.banner', id: 'empty', order: 1, roles: [], component: null }],
        role: DISPATCHER.role,
        context: { ticketId: 't-42', user: DISPATCHER },
      }),
    );

    expect(markup).toBe('<div class="ugra-slot"></div>');
  });
});
