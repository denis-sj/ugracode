import { defineWebModule } from '@ugra/core/web';
import { ReplyFooterWidget } from './ReplyFooterWidget';

/**
 * Веб-часть модуля `applicant-feedback`: черновик ответа заявителю в слоте
 * `ticket.footer` карточки заявки (дизайн 4.4, шаг «Ответ заявителю»).
 */
export default defineWebModule({
  id: 'applicant-feedback',
  widgets: [
    {
      slot: 'ticket.footer',
      id: 'applicant-feedback.reply',
      order: 100,
      roles: ['dispatcher', 'admin'],
      component: ReplyFooterWidget,
    },
  ],
});
