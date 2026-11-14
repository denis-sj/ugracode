import type { ServerModule } from '@ugra/core';
import example from './_example/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [example];

export { example };
