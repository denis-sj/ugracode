import { defineWebModule } from '@ugra/core/web';
import { ScreenshotWidget } from './ScreenshotWidget';

/**
 * Веб-часть `screenshot`: кнопка «Скриншот» в слоте `applicant.chat.footer` —
 * картинка уходит в `POST /api/screenshot`, текст можно добавить в обращение.
 */
export default defineWebModule({
  id: 'screenshot',
  widgets: [
    {
      slot: 'applicant.chat.footer',
      id: 'screenshot.upload',
      order: 100,
      roles: ['applicant'],
      component: ScreenshotWidget,
    },
  ],
});
