import type { ServerModule } from '@ugra/core';
import applicantFeedback from './applicant-feedback/server';
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
import reportEmergency from './report-emergency/server';
import reportHotspots from './report-hotspots/server';
import reportKbGaps from './report-kb-gaps/server';
import reportShift from './report-shift/server';
import reportSla from './report-sla/server';
import reportWorkload from './report-workload/server';
import reportsDashboard from './reports-dashboard/server';
import routing from './routing/server';
import screenshot from './screenshot/server';
import voiceCall from './voice-call/server';

/** Манифест серверных частей модулей: одна строка на модуль, порядок алфавитный. */
export const serverModules: ServerModule[] = [
  applicantFeedback,
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
  reportEmergency,
  reportHotspots,
  reportKbGaps,
  reportShift,
  reportSla,
  reportWorkload,
  reportsDashboard,
  routing,
  screenshot,
  voiceCall,
];

export {
  applicantFeedback,
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
  reportEmergency,
  reportHotspots,
  reportKbGaps,
  reportShift,
  reportSla,
  reportWorkload,
  reportsDashboard,
  routing,
  screenshot,
  voiceCall,
};
