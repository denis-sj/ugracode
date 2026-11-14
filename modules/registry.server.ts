import type { ServerModule } from '@ugra/core';
import example from './_example/server';
import extraction from './extraction/server';
import knowledge from './knowledge/server';
import priority from './priority/server';
import routing from './routing/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [example, extraction, knowledge, priority, routing];

export { example, extraction, knowledge, priority, routing };
