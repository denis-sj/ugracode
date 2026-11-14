import type { JSX } from 'react';
import { createElement, useEffect, useState } from 'react';
import type { SlotWidget } from '@ugra/ui';
import { Slot } from '@ugra/ui';
import type { TicketSlotContext, TicketSlotName } from './ticket-slots';
import { ticketWidgets } from './ticket-slots';

export interface TicketSlotProps {
  name: TicketSlotName;
  widgets: readonly SlotWidget[];
  context: TicketSlotContext;
  className?: string;
}

/** Один слот карточки заявки: роль, порядок и фильтрацию виджетов делает `Slot` из `@ugra/ui`. */
export function TicketSlot({ name, widgets, context, className }: TicketSlotProps): JSX.Element {
  return createElement(Slot, {
    name,
    widgets,
    role: context.user.role,
    className,
    context: {
      ticketId: context.ticketId,
      api: context.api,
      user: context.user,
      trackAction: context.trackAction,
    },
  });
}

/**
 * Реестр веб-модулей → виджеты слотов заявки. Реестр грузим лениво: страница проверки сама
 * входит в этот реестр, статический импорт дал бы циклическую зависимость. Ошибка загрузки
 * реестра не роняет страницу — она рисует запасные блоки.
 */
export function useTicketWidgets(): readonly SlotWidget[] {
  const [widgets, setWidgets] = useState<readonly SlotWidget[]>([]);

  useEffect(() => {
    let alive = true;
    void import('../../registry.web')
      .then((modules) => {
        if (alive) setWidgets(ticketWidgets(modules.webModules));
      })
      .catch(() => {
        if (alive) setWidgets([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return widgets;
}
