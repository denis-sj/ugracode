import { defineWebModule } from '@ugra/core/web';
import { ChatPage } from './ChatPage';
import { TicketsPage } from './TicketsPage';
import './styles.css';

/** Веб-часть `clarify-chat`: обращение заявителя и «Мои заявки» (4.1, 4.2). */
export default defineWebModule({
  id: 'clarify-chat',
  pages: [
    {
      path: '/chat',
      title: 'Обращение',
      icon: 'chat',
      roles: ['applicant'],
      component: ChatPage,
      nav: { section: 'applicant', order: 10 },
    },
    {
      path: '/tickets',
      title: 'Мои заявки',
      icon: 'tickets',
      roles: ['applicant'],
      component: TicketsPage,
      nav: { section: 'applicant', order: 20 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
