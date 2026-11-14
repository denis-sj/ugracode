import type { WebModule } from '@ugra/core';
import applicantFeedbackWeb from './applicant-feedback/web';
import clarifyChatWeb from './clarify-chat/web';
import dispatcherReviewWeb from './dispatcher-review/web';
import emergencyWeb from './emergency/web';
import engineerDeskWeb from './engineer-desk/web';
import exampleWeb from './_example/web';
import reportsDashboardWeb from './reports-dashboard/web';

/** Манифест веб-частей модулей: одна строка на модуль, порядок алфавитный. */
export const webModules: WebModule[] = [
  applicantFeedbackWeb,
  clarifyChatWeb,
  dispatcherReviewWeb,
  emergencyWeb,
  engineerDeskWeb,
  exampleWeb,
  reportsDashboardWeb,
];

export {
  applicantFeedbackWeb,
  clarifyChatWeb,
  dispatcherReviewWeb,
  emergencyWeb,
  engineerDeskWeb,
  exampleWeb,
  reportsDashboardWeb,
};
