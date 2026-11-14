import { defineWebModule } from '@ugra/core/web';
import { ExecutorsPage } from './ExecutorsPage';
import './executors.css';

/**
 * Веб-часть модуля `executors`: экран 12 «Исполнители» (дизайн 4, экран 12).
 * Только чтение поверх API ядра: `/api/engineers` и `/api/tickets?assigneeId`.
 */
export default defineWebModule({
  id: 'executors',
  pages: [
    {
      path: '/executors',
      title: 'Исполнители',
      icon: '👥',
      roles: ['dispatcher', 'admin', 'manager'],
      component: ExecutorsPage,
      nav: { section: 'Работа', order: 40 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
