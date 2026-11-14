import type { WebModule } from '@ugra/core';
import exampleWeb from './_example/web';

/** Манифест веб-частей модулей: одна строка на модуль, порядок алфавитный. */
export const webModules: WebModule[] = [exampleWeb];

export { exampleWeb };
