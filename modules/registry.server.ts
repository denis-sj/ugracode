import type { ServerModule } from '@ugra/core';
import applicantProfile from './applicant-profile/server';
import emergency from './emergency/server';
import example from './_example/server';
import extraction from './extraction/server';
import historySeed from './history-seed/server';
import knowledge from './knowledge/server';
import priority from './priority/server';
import quality from './quality/server';
import reportsDashboard from './reports-dashboard/server';
import routing from './routing/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [
  applicantProfile,
  emergency,
  example,
  extraction,
  historySeed,
  knowledge,
  priority,
  quality,
  reportsDashboard,
  routing,
];

export {
  applicantProfile,
  emergency,
  example,
  extraction,
  historySeed,
  knowledge,
  priority,
  quality,
  reportsDashboard,
  routing,
};
