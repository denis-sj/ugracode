import { defineWebModule } from '@ugra/core/web';
import { ReportsPage } from './ReportsPage';

/** Веб-часть модуля `reports-hub`: страница `/reports` — хаб отчётов О1–О7. */
export default defineWebModule({
  id: 'reports-hub',
  pages: [
    {
      path: '/reports',
      title: 'Отчёты',
      icon: '▦',
      roles: ['manager', 'admin'],
      component: ReportsPage,
      nav: { section: 'Руководитель', order: 20 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
