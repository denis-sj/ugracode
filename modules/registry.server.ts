import type { ServerModule } from '@ugra/core';
import applicantProfile from './applicant-profile/server';
import clarifyChat from './clarify-chat/server';
import emergency from './emergency/server';
import example from './_example/server';
import extraction from './extraction/server';
import historySeed from './history-seed/server';
import knowledge from './knowledge/server';
import massIncident from './mass-incident/server';
import priority from './priority/server';
import quality from './quality/server';
import reportAiEffect from './report-ai-effect/server';
import reportHotspots from './report-hotspots/server';
import reportShift from './report-shift/server';
import reportsDashboard from './reports-dashboard/server';
import routing from './routing/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [
  applicantProfile,
  clarifyChat,
  emergency,
  example,
  extraction,
  historySeed,
  knowledge,
  massIncident,
  priority,
  quality,
  reportAiEffect,
  reportHotspots,
  reportShift,
  reportsDashboard,
  routing,
];

export {
  applicantProfile,
  clarifyChat,
  emergency,
  example,
  extraction,
  historySeed,
  knowledge,
  massIncident,
  priority,
  quality,
  reportAiEffect,
  reportHotspots,
  reportShift,
  reportsDashboard,
  routing,
};
