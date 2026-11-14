import { defineWebModule } from '@ugra/core/web';
import { QualityPage } from './QualityPage';

/** Веб-часть модуля `quality`: экран руководителя `/quality` — прогон набора и таблица «эталон / ИИ». */
export default defineWebModule({
  id: 'quality',
  pages: [
    {
      path: '/quality',
      title: 'Качество ИИ',
      icon: '✓',
      roles: ['manager', 'admin'],
      component: QualityPage,
      nav: { section: 'Отчёты', order: 20 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
