import { defineWebModule } from '@ugra/core/web';
import { QueuePage } from './QueuePage';
import { ReviewPage } from './ReviewPage';

/** Веб-часть модуля `dispatcher-review`: очередь и проверка заявки по шагам. */
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
    {
      path: '/review',
      title: 'Проверка заявки',
      icon: '✓',
      roles: ['dispatcher', 'admin', 'manager'],
      component: ReviewPage,
      nav: { section: 'Работа', order: 30 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
