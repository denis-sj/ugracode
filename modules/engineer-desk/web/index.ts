import { defineWebModule } from '@ugra/core/web';
import { EngineerDeskPage } from './EngineerDeskPage';
import './engineer-desk.css';

/** Веб-часть `engineer-desk`: рабочее место инженера (4.6) — задачи, диагностика, результат. */
export default defineWebModule({
  id: 'engineer-desk',
  pages: [
    {
      path: '/tasks',
      title: 'Мои задачи',
      icon: 'tasks',
      roles: ['engineer', 'admin'],
      component: EngineerDeskPage,
      nav: { section: 'Работа', order: 30 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
