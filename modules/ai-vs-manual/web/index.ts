import { defineWebModule } from '@ugra/core/web';
import { MeasurePage } from './MeasurePage';

/** Веб-часть модуля `ai-vs-manual`: страница замера К4 «с ИИ / без ИИ». */
export default defineWebModule({
  id: 'ai-vs-manual',
  pages: [
    {
      path: '/measure',
      title: 'С ИИ / без ИИ',
      icon: '⇄',
      roles: ['dispatcher', 'admin'],
      component: MeasurePage,
      nav: { section: 'Работа', order: 60 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
