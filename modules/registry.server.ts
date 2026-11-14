import type { ServerModule } from '@ugra/core';
import example from './_example/server';
import knowledge from './knowledge/server';
import routing from './routing/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [example, knowledge, routing];

export { example, knowledge, routing };
