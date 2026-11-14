import type { WebModule } from '@ugra/core';
import aiVsManualWeb from './ai-vs-manual/web';
import applicantFeedbackWeb from './applicant-feedback/web';
import clarifyChatWeb from './clarify-chat/web';
import dispatcherReviewWeb from './dispatcher-review/web';
import emergencyWeb from './emergency/web';
import executorsWeb from './executors/web';
import engineerDeskWeb from './engineer-desk/web';
import exampleWeb from './_example/web';
import journalWeb from './journal/web';
import knowledgeWeb from './knowledge/web';
import qualityWeb from './quality/web';
import reportsDashboardWeb from './reports-dashboard/web';
import screenshotWeb from './screenshot/web';

/** Манифест веб-частей модулей: одна строка на модуль, порядок алфавитный. */
export const webModules: WebModule[] = [
  aiVsManualWeb,
  applicantFeedbackWeb,
  clarifyChatWeb,
  dispatcherReviewWeb,
  emergencyWeb,
  engineerDeskWeb,
  exampleWeb,
  executorsWeb,
  journalWeb,
  knowledgeWeb,
  qualityWeb,
  reportsDashboardWeb,
  screenshotWeb,
];

export {
  aiVsManualWeb,
  applicantFeedbackWeb,
  clarifyChatWeb,
  dispatcherReviewWeb,
  emergencyWeb,
  engineerDeskWeb,
  exampleWeb,
  executorsWeb,
  journalWeb,
  knowledgeWeb,
  qualityWeb,
  reportsDashboardWeb,
  screenshotWeb,
};
