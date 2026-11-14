import { defineWebModule } from '@ugra/core/web';
import { KnowledgePage } from './KnowledgePage';
import './knowledge.css';

/** Веб-часть `knowledge`: экран 13 «База знаний» инженера (4.6). */
export default defineWebModule({
  id: 'knowledge',
  pages: [
    {
      path: '/knowledge',
      title: 'База знаний',
      icon: 'knowledge',
      roles: ['engineer', 'admin'],
      component: KnowledgePage,
      nav: { section: 'Работа', order: 40 },
    },
  ],
  widgets: [],
  chatCards: [],
  reportViews: [],
});
