import { z } from 'zod';
import type { DomainEvent } from './events';
import {
  Appeal,
  AppealMessage,
  Channel,
  ChatCard,
  PriorityLevel,
  Role,
  SettingRecord,
  StepRun,
  Ticket,
  TicketDetail,
  TicketField,
  TicketStatus,
  User,
  UserNotification,
} from './domain';
import { DictionaryItem, FieldDef } from './fields';

export const ErrorResponse = z.object({ error: z.string(), message: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const SessionInput = z.object({ userId: z.string().min(1) });
export type SessionInput = z.infer<typeof SessionInput>;

export const SessionResponse = z.object({ user: User });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const UsersResponse = z.object({ users: z.array(User) });
export type UsersResponse = z.infer<typeof UsersResponse>;

export const CreateAppealInput = z.object({
  text: z.string().min(1),
  channel: Channel.default('chat'),
  attachments: z.array(z.string()).default([]),
  /** `true` — ответ сразу после создания заявки, разбор идёт в фоне и стримится в SSE. */
  async: z.boolean().default(false),
});
export type CreateAppealInput = z.infer<typeof CreateAppealInput>;

export const CreateAppealResponse = z.object({
  appealId: z.string(),
  ticketId: z.string(),
  runId: z.string(),
});
export type CreateAppealResponse = z.infer<typeof CreateAppealResponse>;

/**
 * Сообщение в чате обращения: текст заявителя, ответ на карточку-вопрос,
 * карточка от системы или системная запись (раздел 3.1 спецификации фич).
 */
export const PostAppealMessageInput = z.object({
  kind: z.enum(['text', 'question_card', 'answer', 'system', 'card']).default('text'),
  body: z.string().min(1).max(4000),
  /** Поле, к которому относится вопрос или ответ. */
  fieldKey: z.string().min(1).optional(),
  card: ChatCard.optional(),
});
export type PostAppealMessageInput = z.infer<typeof PostAppealMessageInput>;

/** История чата обращения в порядке отправки. */
export const AppealMessagesResponse = z.object({ messages: z.array(AppealMessage) });
export type AppealMessagesResponse = z.infer<typeof AppealMessagesResponse>;

/** Ответ на сообщение: что сохранили, к какой заявке и запускался ли повторный разбор. */
export const PostAppealMessageResponse = z.object({
  message: AppealMessage,
  ticketId: z.string(),
  runId: z.string().nullable(),
});
export type PostAppealMessageResponse = z.infer<typeof PostAppealMessageResponse>;

export const BooleanQuery = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional(),
);

export const TicketListQuery = z.object({
  status: TicketStatus.optional(),
  assigneeId: z.string().optional(),
  isEmergency: BooleanQuery,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const TicketListResponse = z.object({ tickets: z.array(Ticket) });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

export const TicketResponse = z.object({
  ticket: Ticket,
  appeal: Appeal,
  fields: z.array(TicketField),
  steps: z.array(StepRun),
  events: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type TicketResponse = z.infer<typeof TicketResponse>;

export type { TicketDetail };

export const ProfileEquipment = z.object({
  id: z.string(),
  equipmentId: z.string(),
  note: z.string().nullable(),
  /** Человекочитаемая подпись из CMDB (тип и модель). */
  label: z.string().optional(),
});
export type ProfileEquipment = z.infer<typeof ProfileEquipment>;

export const ProfileResponse = z.object({
  user: User,
  profile: z
    .object({
      userId: z.string(),
      building: z.string().nullable(),
      floor: z.string().nullable(),
      cabinet: z.string().nullable(),
      equipmentId: z.string().nullable(),
      updatedAt: z.string().optional(),
    })
    .nullable(),
  equipment: z.array(ProfileEquipment),
});
export type ProfileResponse = z.infer<typeof ProfileResponse>;

/** Где сидит сотрудник: корпус и кабинет; этаж сервер берёт из CMDB или из первой цифры кабинета. */
export const ProfilePlaceInput = z.object({
  building: z.string().trim().min(1, 'Укажите корпус').max(16),
  cabinet: z.string().trim().min(1, 'Укажите кабинет').max(16),
});
export type ProfilePlaceInput = z.infer<typeof ProfilePlaceInput>;

/** Закрепить технику из CMDB за собой. */
export const ProfileEquipmentInput = z.object({
  equipmentId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(120).optional(),
});
export type ProfileEquipmentInput = z.infer<typeof ProfileEquipmentInput>;

/** Что можно выбрать в профиле: корпуса и техника из CMDB. */
export const ProfileOptionsResponse = z.object({
  buildings: z.array(z.object({ code: z.string(), label: z.string() })),
  equipment: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      building: z.string().nullable(),
      cabinet: z.string().nullable(),
    }),
  ),
});
export type ProfileOptionsResponse = z.infer<typeof ProfileOptionsResponse>;

/** Новый сотрудник: руководитель заводит его сразу с ролью и, по желанию, рабочим местом. */
export const CreateUserInput = z.object({
  fullName: z.string().trim().min(3, 'Укажите фамилию и имя').max(80),
  role: Role,
  position: z.string().trim().min(2, 'Укажите должность').max(80),
  departmentId: z.string().trim().max(64).nullable().optional(),
  building: z.string().trim().max(16).optional(),
  cabinet: z.string().trim().max(16).optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

/** Смена роли сотрудника. */
export const UpdateUserRoleInput = z.object({ role: Role });
export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleInput>;

export const EventsResponse = z.object({ events: z.array(z.unknown()) });
export type EventsResponse = { events: DomainEvent[] };

export const EngineerSkillInfo = z.object({
  skill: z.string(),
  level: z.number(),
});
export const EngineerInfo = z.object({
  id: z.string(),
  fullName: z.string(),
  departmentId: z.string().nullable(),
  position: z.string().nullable(),
  level: z.union([z.number(), z.string()]).optional(),
  skills: z.array(EngineerSkillInfo).default([]),
  buildings: z.array(z.string()).default([]),
  onShift: z.boolean().default(false),
  openTickets: z.number().int().nonnegative().default(0),
  resolvedSimilar: z.number().int().nonnegative().default(0),
});
export type EngineerInfo = z.infer<typeof EngineerInfo>;

export const EngineersResponse = z.object({ engineers: z.array(EngineerInfo) });
export type EngineersResponse = z.infer<typeof EngineersResponse>;

export const NotificationsResponse = z.object({ notifications: z.array(UserNotification) });
export type NotificationsResponse = z.infer<typeof NotificationsResponse>;

export const SettingsResponse = z.object({ settings: z.array(SettingRecord) });
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const UpdateFieldInput = z.object({ value: z.union([z.string(), z.number()]).nullable() });
export type UpdateFieldInput = z.infer<typeof UpdateFieldInput>;

export const ConfirmTicketInput = z.object({ assigneeId: z.string().min(1) });
export type ConfirmTicketInput = z.infer<typeof ConfirmTicketInput>;

export const TransitionInput = z.object({ to: TicketStatus, reason: z.string().min(1).max(300).optional() });
export type TransitionInput = z.infer<typeof TransitionInput>;

export const ReanalyzeResponse = z.object({ runId: z.string(), ticketId: z.string() });
export type ReanalyzeResponse = z.infer<typeof ReanalyzeResponse>;

export const TranscribeInput = z.object({
  audio: z.string().min(1),
  mimeType: z.string().min(1),
  language: z.string().optional(),
});
export type TranscribeInput = z.infer<typeof TranscribeInput>;

export const TranscribeResponse = z.object({
  text: z.string(),
  language: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;

/** Скриншот ошибки или фото шильдика: картинка в base64 и её тип. */
export const ScreenshotInput = z.object({
  image: z.string().min(1),
  mimeType: z.string().regex(/^image\//, 'нужен mimeType картинки: image/*'),
});
export type ScreenshotInput = z.infer<typeof ScreenshotInput>;

export const ScreenshotResponse = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ScreenshotResponse = z.infer<typeof ScreenshotResponse>;

export const DeadlineInput = z.object({
  slaDueAt: z.string().min(1),
  reason: z.string().min(1),
});
export type DeadlineInput = z.infer<typeof DeadlineInput>;

export const ResolutionInput = z.object({ text: z.string().min(1) });
export type ResolutionInput = z.infer<typeof ResolutionInput>;

export const TicketAnalysisResponse = z.object({
  ticketId: z.string(),
  runId: z.string(),
  analysis: z.record(z.string(), z.unknown()),
});
export type TicketAnalysisResponse = z.infer<typeof TicketAnalysisResponse>;

export const UpdateSettingInput = z.object({ value: z.unknown() });
export type UpdateSettingInput = z.infer<typeof UpdateSettingInput>;

export const MetaResponse = z.object({
  modules: z.array(z.object({ id: z.string(), title: z.string() })),
  fields: z.array(FieldDef),
  dictionaries: z.array(DictionaryItem),
  aiMode: z.enum(['stub', 'cloud']),
  roles: z.array(Role),
  priorities: z.array(PriorityLevel),
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/** События хода разбора, которые уходят в SSE. */
export const AgentTraceStatus = z.enum(['running', 'done', 'blocked', 'error']);
export type AgentTraceStatus = z.infer<typeof AgentTraceStatus>;

export const RunStreamEvent = z.object({
  type: z.enum([
    'step.started',
    'step.progress',
    'step.completed',
    'agent.step',
    'run.completed',
    'run.failed',
  ]),
  runId: z.string(),
  appealId: z.string(),
  stepId: z.string().optional(),
  message: z.string().optional(),
  fields: z.array(z.string()).optional(),
  status: z.union([z.string(), AgentTraceStatus]).optional(),
  /** Шаг работы агента (только для `agent.step`), безопасный для заявителя. */
  n: z.number().int().positive().optional(),
  tool: z.string().optional(),
  label: z.string().optional(),
  summary: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type RunStreamEvent = z.infer<typeof RunStreamEvent>;

export const HealthResponse = z.object({ status: z.literal('ok'), service: z.string() });
export type HealthResponse = z.infer<typeof HealthResponse>;
