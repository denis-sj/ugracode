import { defineWebModule } from '@ugra/core/web';
import { QueuePage } from './QueuePage';

/** Веб-часть модуля `dispatcher-review`: очередь и карточка заявки. */
export default defineWebModule({
  id: 'dispatcher-review',
  pages: [
    {
      path: '/queue',
      title: 'Очередь заявок',
      icon: '▤',
      roles: ['dispatcher', 'admin', 'manager'],
      component: QueuePage,
      nav: { section: 'Работа', order: 20 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
