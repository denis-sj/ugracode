import type { User } from '@ugra/contracts';
import type { WebModule } from '@ugra/core/web';
import type { ApiClient, SlotWidget } from '@ugra/ui';

/**
 * Слоты карточки заявки: `ticket.banner` и `ticket.footer` (дизайн 4.4, 4.5).
 *
 * Здесь только чистый отбор виджетов из манифеста `modules/registry.web.ts` — без React,
 * чтобы правила слотов проверялись тестами. Рендер и ленивую загрузку реестра держит
 * `TicketSlot.tsx`: страница проверки сама входит в реестр, статический импорт дал бы цикл.
 */

export type TicketSlotName = 'ticket.banner' | 'ticket.footer';

const TICKET_SLOTS: readonly string[] = ['ticket.banner', 'ticket.footer'];

export interface TicketSlotContext {
  ticketId: string;
  api?: ApiClient;
  user: User;
  trackAction?: (kind: 'click' | 'input' | 'select' | 'navigate' | 'system') => void;
}

/** Виджеты карточки заявки из веб-модулей: только слоты заявки, без страниц и прочих слотов. */
export function ticketWidgets(modules: readonly WebModule[]): readonly SlotWidget[] {
  return modules.flatMap((module) => module.widgets).filter((widget) => TICKET_SLOTS.includes(widget.slot));
}

/** Есть ли в слоте хотя бы один виджет для этой роли: без него страница рисует свой запасной блок. */
export function hasTicketWidget(widgets: readonly SlotWidget[], name: TicketSlotName, role?: string): boolean {
  return widgets.some(
    (widget) =>
      widget.slot === name && (role === undefined || widget.roles.length === 0 || widget.roles.includes(role)),
  );
}
