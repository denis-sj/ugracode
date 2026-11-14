import { defineWebModule } from '@ugra/core/web';

export default defineWebModule({
  id: 'example',
  pages: [],
  widgets: [
    {
      slot: 'shell.topbar',
      id: 'example.badge',
      order: 10,
      roles: ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'],
      component: null,
    },
  ],
  chatCards: [],
  reportViews: [],
});
