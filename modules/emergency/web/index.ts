import { defineWebModule } from '@ugra/core/web';
import { EmergencyBanner } from './EmergencyBanner';
import { IncidentsPage } from './IncidentsPage';

/**
 * Веб-часть модуля `emergency`: экран «Авария и массовость» (дизайн 4.5) и плашка
 * `ticket.banner` для карточки заявки.
 */
export default defineWebModule({
  id: 'emergency',
  pages: [
    {
      path: '/incidents',
      title: 'Аварии и массовость',
      icon: '⚠',
      roles: ['dispatcher', 'admin', 'manager'],
      component: IncidentsPage,
      nav: { section: 'Работа', order: 30 },
    },
  ],
  widgets: [
    {
      slot: 'ticket.banner',
      id: 'emergency.banner',
      order: 10,
      roles: ['dispatcher', 'admin', 'manager'],
      component: EmergencyBanner,
    },
  ],
});
