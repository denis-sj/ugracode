import { defineWebModule } from '@ugra/core/web';
import { ChatPage } from './ChatPage';
import { QuestionCard } from './QuestionCard';

/** Веб-часть модуля `clarify-chat`: страница заявителя и карточки-вопросы. */
export default defineWebModule({
  id: 'clarify-chat',
  pages: [
    {
      path: '/chat',
      title: 'Новое обращение',
      icon: '✎',
      roles: ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'],
      component: ChatPage,
      nav: { section: 'Работа', order: 10 },
    },
  ],
  widgets: [],
  chatCards: [
    { widget: 'buttons', component: QuestionCard },
    { widget: 'select', component: QuestionCard },
    { widget: 'text', component: QuestionCard },
    { widget: 'location', component: QuestionCard },
  ],
  reportViews: [],
});
