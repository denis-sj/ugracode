import { defineWebModule } from '@ugra/core/web';
import { CallsPage } from './CallsPage';

export { PhoneCallPage } from './PhoneCallPage';

/** Веб-часть модуля `voice-call`: экран диспетчера «Входящий звонок» с репликами ИИ-оператора вживую. */
export default defineWebModule({
  id: 'voice-call',
  pages: [
    {
      path: '/calls',
      title: 'Входящий звонок',
      icon: '☎',
      roles: ['dispatcher', 'admin'],
      component: CallsPage,
      nav: { section: 'Работа', order: 15 },
    },
  ],
});
