import type { ComponentType, JSX, ReactNode } from 'react';
import { createElement } from 'react';
import { cx } from '../cx';
import type { SlotWidget } from '../types';

export interface SlotProps {
  /** Имя слота: `shell.topbar`, `dashboard.tiles`, `ticket.banner` и т. п. */
  name: string;
  widgets: readonly SlotWidget[];
  /** Роль пользователя: виджеты с чужими ролями не рисуются. */
  role?: string;
  /** Пропсы, которые получает каждый виджет слота. */
  context?: Record<string, unknown>;
  empty?: ReactNode;
  className?: string;
}

type WidgetComponent = ComponentType<Record<string, unknown>>;

function isRenderable(component: unknown): component is WidgetComponent | ComponentType<Record<string, never>> {
  return typeof component === 'function' || (typeof component === 'object' && component !== null);
}

/** Рисует виджеты слота по порядку `order`. Выключенный модуль просто не попадает в массив. */
export function Slot({ name, widgets, role, context = {}, empty = null, className }: SlotProps): JSX.Element {
  const visible = widgets
    .filter((widget) => widget.slot === name)
    .filter((widget) => !role || widget.roles.length === 0 || widget.roles.includes(role))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  if (visible.length === 0) {
    return <>{empty}</>;
  }

  return (
    <div className={cx('ugra-slot', className)}>
      {visible.map((widget) => {
        if (!isRenderable(widget.component)) {
          // Виджет без компонента (например, образец до реализации) просто не рисуем.
          return null;
        }
        const Component = widget.component as WidgetComponent;
        return createElement(Component, { key: widget.id, ...context });
      })}
    </div>
  );
}
