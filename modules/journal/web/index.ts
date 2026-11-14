import { defineWebModule } from '@ugra/core/web';
import { JournalPage } from './JournalPage';

/** Веб-часть модуля `journal`: экран 11 «Журнал действий» диспетчера (дизайн 4, `Log.dc.html`). */
export default defineWebModule({
  id: 'journal',
  pages: [
    {
      path: '/journal',
      title: 'Журнал действий',
      icon: '≡',
      roles: ['dispatcher', 'admin', 'manager'],
      component: JournalPage,
      nav: { section: 'Работа', order: 40 },
    },
  ],
});
