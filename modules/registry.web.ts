import type { WebModule } from '@ugra/core';
import clarifyChatWeb from './clarify-chat/web';
import dispatcherReviewWeb from './dispatcher-review/web';
import exampleWeb from './_example/web';

/** Манифест веб-частей модулей: одна строка на модуль, порядок алфавитный. */
export const webModules: WebModule[] = [clarifyChatWeb, dispatcherReviewWeb, exampleWeb];

export { clarifyChatWeb, dispatcherReviewWeb, exampleWeb };
