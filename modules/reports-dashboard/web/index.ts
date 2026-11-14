import { defineWebModule } from '@ugra/core/web';
import { DashboardPage } from './DashboardPage';
import { TilesWidget } from './TilesWidget';

/** Веб-часть модуля `reports-dashboard`: страница `/dashboard` и виджеты дашборда. */
export default defineWebModule({
  id: 'reports-dashboard',
  pages: [
    {
      path: '/dashboard',
      title: 'Дашборд',
      icon: '▤',
      roles: ['manager', 'admin'],
      component: DashboardPage,
      nav: { section: 'Отчёты', order: 10 },
    },
  ],
  widgets: [
    {
      slot: 'dashboard.tiles',
      id: 'reports-dashboard.tiles',
      order: 20,
      roles: ['manager', 'admin'],
      component: TilesWidget,
    },
  ],
  chatCards: [],
  reportViews: [],
});
