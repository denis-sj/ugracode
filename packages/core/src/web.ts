/**
 * Веб-часть ядра: `defineWebModule` и типы экранов.
 * Отдельная точка входа, чтобы браузерный бандл не тянул серверный код (`node:crypto`).
 */
export { defineWebModule } from './module';
export type {
  ChatCardDef,
  PageDef,
  ReportViewDef,
  ServerModule,
  WebModule,
  WebModuleDefinition,
  WidgetDef,
} from './module';
