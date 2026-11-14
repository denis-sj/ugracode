import { defineWebModule } from '@ugra/core/web';

/**
 * Виджет `ticket.banner`: красный режим на карточке заявки (диспетчер, руководитель, админ).
 * Данные готовит `emergencyBanner()` из `web/banner.ts`; рендер карточки — в `apps/web`,
 * там слот `ticket.banner` ещё не подключён (см. `docs/map/features/emergency.md`).
 */
export default defineWebModule({
  id: 'emergency',
  widgets: [
    {
      slot: 'ticket.banner',
      id: 'emergency.banner',
      order: 10,
      roles: ['dispatcher', 'admin', 'manager'],
      component: null,
    },
  ],
});
