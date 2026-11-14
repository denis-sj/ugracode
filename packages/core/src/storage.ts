import type {
  Appeal,
  AppealMessage,
  DomainEvent,
  PipelineRun,
  PriorityLevel,
  SettingRecord,
  StepRun,
  Ticket,
  TicketField,
  TicketStatus,
  User,
  UserNotification,
} from '@ugra/contracts';
import type { AgentStepRecord } from './agent';
import type {
  KnowledgeArticle,
  KnowledgeSearchQuery,
  SimilarTicket,
  SimilarTicketQuery,
} from './knowledge';
import { DEFAULT_KNOWLEDGE_LIMIT, articleText, knowledgeWords, matchScore } from './knowledge';

export interface TicketFilter {
  status?: TicketStatus;
  assigneeId?: string;
  isEmergency?: boolean;
  limit?: number;
}

export interface EventFilter {
  ticketId?: string;
  type?: string;
  limit?: number;
}

/** Статус инцидента массовости: открыт, пока диспетчер не закроет. */
export type IncidentStatus = 'open' | 'closed';

/**
 * Инцидент массовости: одна карточка для похожих обращений (таблица `incident`).
 * Живёт в ядре, потому что заявка ссылается на него полем `incidentId`.
 */
export interface Incident {
  id: string;
  number: string;
  status: IncidentStatus;
  category: string | null;
  building: string | null;
  system: string | null;
  /** Сколько заявок привязано к инциденту. */
  size: number;
  priority: PriorityLevel | null;
  openedAt: string;
  closedAt: string | null;
}

export interface IncidentFilter {
  status?: IncidentStatus;
  limit?: number;
}

/**
 * Профиль заявителя: место работы и основная техника для предзаполнения полей.
 * Живёт в таблице `applicant_profile` (модуль `applicant-profile`).
 */
export interface ApplicantProfile {
  userId: string;
  building: string | null;
  floor: string | null;
  cabinet: string | null;
  equipmentId: string | null;
  /** Время последнего сохранения; при записи можно не указывать — хранилище поставит своё. */
  updatedAt?: string;
}

/** Техника, закреплённая за заявителем (таблица `applicant_equipment`). */
export interface ApplicantEquipment {
  id: string;
  userId: string;
  equipmentId: string;
  note: string | null;
}

/**
 * Отметка шага статьи базы знаний на карточке инженера (таблица `ticket_article_step`).
 * Состояние живёт у заявки: повторных статей с тем же индексом шага не бывает.
 */
export interface ArticleStepState {
  ticketId: string;
  articleId: string;
  /** Порядковый номер шага в статье, начиная с нуля. */
  stepIndex: number;
  done: boolean;
  updatedAt: string;
}

/** Хранилище ядра. Реализации: память (тесты) и PostgreSQL (`@ugra/db`). */
export interface KernelStore {
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  saveUser(user: User): Promise<void>;

  /** Профиль заявителя по id пользователя; нет профиля (гость) — `null`. */
  getApplicantProfile(userId: string): Promise<ApplicantProfile | null>;
  /** Сохраняет профиль заявителя (повторная запись обновляет его). */
  saveApplicantProfile(profile: ApplicantProfile): Promise<void>;
  /** Техника, закреплённая за заявителем (`applicant_equipment`). */
  listApplicantEquipment(userId: string): Promise<ApplicantEquipment[]>;

  saveAppeal(appeal: Appeal): Promise<void>;
  getAppeal(id: string): Promise<Appeal | null>;

  /** Сообщение чата обращения: вопрос-карточка, ответ, системная запись (`appeal_message`). */
  saveAppealMessage(message: AppealMessage): Promise<void>;
  /** История чата обращения в порядке отправки. */
  listAppealMessages(appealId: string): Promise<AppealMessage[]>;

  saveTicket(ticket: Ticket): Promise<void>;
  updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket | null>;
  getTicket(id: string): Promise<Ticket | null>;
  listTickets(filter?: TicketFilter): Promise<Ticket[]>;

  saveTicketFields(ticketId: string, fields: TicketField[]): Promise<void>;
  updateTicketField(ticketId: string, fieldKey: string, patch: Partial<TicketField>): Promise<TicketField | null>;
  getTicketFields(ticketId: string): Promise<TicketField[]>;

  /** Инцидент массовости: создание или полная запись (повторная запись обновляет). */
  saveIncident(incident: Incident): Promise<void>;
  getIncident(id: string): Promise<Incident | null>;
  listIncidents(filter?: IncidentFilter): Promise<Incident[]>;
  updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null>;

  savePipelineRun(run: PipelineRun): Promise<void>;
  savePipelineStep(step: StepRun): Promise<void>;
  listPipelineSteps(filter: { runId?: string; ticketId?: string }): Promise<StepRun[]>;

  /** След агента: шаги одного прогона (таблица `agent_step`). */
  saveAgentStep(step: AgentStepRecord): Promise<void>;
  listAgentSteps(filter: { runId: string; limit?: number }): Promise<AgentStepRecord[]>;

  appendEvent(event: DomainEvent): Promise<void>;
  listEvents(filter?: EventFilter): Promise<DomainEvent[]>;

  saveNotification(notification: UserNotification): Promise<void>;
  listNotifications(userId?: string): Promise<UserNotification[]>;
  markNotificationRead(id: string, userId: string): Promise<UserNotification | null>;

  listSettings(): Promise<SettingRecord[]>;
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRecord>;

  /** Статья базы знаний по id (инструмент `kb_get_article`). */
  getKnowledgeArticle(id: string): Promise<KnowledgeArticle | null>;
  /** Поиск статей по словам без эмбеддингов (инструмент `kb_search`). */
  searchKnowledge(query: KnowledgeSearchQuery): Promise<KnowledgeArticle[]>;
  /** Похожие заявки по словам, категории и корпусу (инструмент `tickets_find_similar`). */
  findSimilarTickets(query: SimilarTicketQuery): Promise<SimilarTicket[]>;
  /** Наполнение базы знаний в памяти: тесты и демо без базы. */
  saveKnowledgeArticle(article: KnowledgeArticle): Promise<void>;

  /** Отметки шагов статей у заявки; нет отметок — пустой список. */
  listArticleSteps(ticketId: string): Promise<ArticleStepState[]>;
  /** Поставить или снять галочку шага статьи; повтор с тем же `done` ничего не меняет. */
  toggleArticleStep(
    ticketId: string,
    articleId: string,
    stepIndex: number,
    done: boolean,
  ): Promise<ArticleStepState>;
}

/** Хранилище в памяти: тесты, тест-контракт и демо без базы. */
export class MemoryStore implements KernelStore {
  private readonly users = new Map<string, User>();
  private readonly appeals = new Map<string, Appeal>();
  private readonly appealMessages = new Map<string, AppealMessage>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly fields = new Map<string, TicketField[]>();
  private readonly incidents = new Map<string, Incident>();
  private readonly runs = new Map<string, PipelineRun>();
  private readonly steps: StepRun[] = [];
  private readonly agentSteps: AgentStepRecord[] = [];
  private readonly events: DomainEvent[] = [];
  private readonly notifications = new Map<string, UserNotification>();
  private readonly settings = new Map<string, SettingRecord>();
  private readonly knowledge = new Map<string, KnowledgeArticle>();
  private readonly articleSteps = new Map<string, ArticleStepState>();
  private readonly applicantProfiles = new Map<string, ApplicantProfile>();
  private readonly applicantEquipment = new Map<string, ApplicantEquipment>();

  async listUsers(): Promise<User[]> {
    return [...this.users.values()];
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async saveAppeal(appeal: Appeal): Promise<void> {
    this.appeals.set(appeal.id, appeal);
  }

  async getAppeal(id: string): Promise<Appeal | null> {
    return this.appeals.get(id) ?? null;
  }

  async saveAppealMessage(message: AppealMessage): Promise<void> {
    this.appealMessages.set(message.id, { ...message });
  }

  async listAppealMessages(appealId: string): Promise<AppealMessage[]> {
    return [...this.appealMessages.values()]
      .filter((message) => message.appealId === appealId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((message) => ({ ...message }));
  }

  async saveTicket(ticket: Ticket): Promise<void> {
    this.tickets.set(ticket.id, ticket);
  }

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket | null> {
    const current = this.tickets.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.tickets.set(id, next);
    return next;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.tickets.get(id) ?? null;
  }

  async listTickets(filter: TicketFilter = {}): Promise<Ticket[]> {
    let result = [...this.tickets.values()];
    if (filter.status) result = result.filter((t) => t.status === filter.status);
    if (filter.assigneeId) result = result.filter((t) => t.assigneeId === filter.assigneeId);
    if (filter.isEmergency !== undefined) result = result.filter((t) => t.isEmergency === filter.isEmergency);
    return result.slice(0, filter.limit ?? 50);
  }

  async saveTicketFields(ticketId: string, fields: TicketField[]): Promise<void> {
    this.fields.set(ticketId, fields);
  }

  async updateTicketField(
    ticketId: string,
    fieldKey: string,
    patch: Partial<TicketField>,
  ): Promise<TicketField | null> {
    const list = this.fields.get(ticketId) ?? [];
    const index = list.findIndex((field) => field.fieldKey === fieldKey);
    if (index < 0) return null;
    const current = list[index];
    if (!current) return null;
    const next = { ...current, ...patch, ticketId, fieldKey };
    list[index] = next;
    return next;
  }

  async getTicketFields(ticketId: string): Promise<TicketField[]> {
    return this.fields.get(ticketId) ?? [];
  }

  async saveIncident(incident: Incident): Promise<void> {
    this.incidents.set(incident.id, { ...incident });
  }

  async getIncident(id: string): Promise<Incident | null> {
    const incident = this.incidents.get(id);
    return incident ? { ...incident } : null;
  }

  async listIncidents(filter: IncidentFilter = {}): Promise<Incident[]> {
    return [...this.incidents.values()]
      .filter((incident) => !filter.status || incident.status === filter.status)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.number.localeCompare(b.number))
      .slice(0, filter.limit ?? 50)
      .map((incident) => ({ ...incident }));
  }

  async updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
    const current = this.incidents.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.incidents.set(id, next);
    return { ...next };
  }

  async savePipelineRun(run: PipelineRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async savePipelineStep(step: StepRun): Promise<void> {
    this.steps.push(step);
  }

  async listPipelineSteps(filter: { runId?: string; ticketId?: string }): Promise<StepRun[]> {
    return this.steps.filter(
      (step) =>
        (!filter.runId || step.runId === filter.runId) &&
        (!filter.ticketId || step.ticketId === filter.ticketId),
    );
  }

  async saveAgentStep(step: AgentStepRecord): Promise<void> {
    this.agentSteps.push(step);
  }

  async listAgentSteps(filter: { runId: string; limit?: number }): Promise<AgentStepRecord[]> {
    const steps = this.agentSteps
      .filter((step) => step.runId === filter.runId)
      .sort((a, b) => a.n - b.n);
    return filter.limit === undefined ? steps : steps.slice(0, filter.limit);
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(filter: EventFilter = {}): Promise<DomainEvent[]> {
    let result = this.events;
    if (filter.ticketId) result = result.filter((e) => e.ticketId === filter.ticketId);
    if (filter.type) result = result.filter((e) => e.type === filter.type);
    return filter.limit ? result.slice(-filter.limit) : result;
  }

  async saveNotification(notification: UserNotification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async listNotifications(userId?: string): Promise<UserNotification[]> {
    return [...this.notifications.values()].filter((item) => !userId || item.toUserId === userId);
  }

  async markNotificationRead(id: string, userId: string): Promise<UserNotification | null> {
    const current = this.notifications.get(id);
    if (!current || current.toUserId !== userId) return null;
    const next = { ...current, readAt: new Date().toISOString() };
    this.notifications.set(id, next);
    return next;
  }

  async listSettings(): Promise<SettingRecord[]> {
    return [...this.settings.values()];
  }

  async setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRecord> {
    const record: SettingRecord = { key, value, updatedBy, updatedAt: new Date().toISOString() };
    this.settings.set(key, record);
    return record;
  }

  async getApplicantProfile(userId: string): Promise<ApplicantProfile | null> {
    const profile = this.applicantProfiles.get(userId);
    return profile ? { ...profile } : null;
  }

  async saveApplicantProfile(profile: ApplicantProfile): Promise<void> {
    this.applicantProfiles.set(profile.userId, {
      ...profile,
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
    });
  }

  async listApplicantEquipment(userId: string): Promise<ApplicantEquipment[]> {
    return [...this.applicantEquipment.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({ ...item }));
  }

  /** Наполнение техники в памяти: сид и тесты, в интерфейсе `KernelStore` только чтение. */
  async saveApplicantEquipment(item: ApplicantEquipment): Promise<void> {
    this.applicantEquipment.set(item.id, { ...item });
  }

  async saveKnowledgeArticle(article: KnowledgeArticle): Promise<void> {
    this.knowledge.set(article.id, {
      ...article,
      symptoms: [...article.symptoms],
      steps: [...article.steps],
    });
  }

  async getKnowledgeArticle(id: string): Promise<KnowledgeArticle | null> {
    return this.knowledge.get(id) ?? null;
  }

  async searchKnowledge(query: KnowledgeSearchQuery): Promise<KnowledgeArticle[]> {
    const words = knowledgeWords(query.text);
    if (words.length === 0) return [];
    const limit = query.limit ?? DEFAULT_KNOWLEDGE_LIMIT;
    if (limit <= 0) return [];

    const category = normalizeCategory(query.category);
    const hits: KnowledgeArticle[] = [];
    for (const article of this.knowledge.values()) {
      if (category && normalizeCategory(article.category) !== category) continue;
      const score = matchScore(words, articleText(article));
      if (score === 0) continue;
      hits.push({
        ...article,
        symptoms: [...article.symptoms],
        steps: [...article.steps],
        score,
      });
    }
    return hits
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async findSimilarTickets(query: SimilarTicketQuery): Promise<SimilarTicket[]> {
    const words = knowledgeWords(query.text ?? '');
    const category = normalizeCategory(query.category);
    const building = query.building?.trim().toLowerCase();
    const limit = query.limit ?? DEFAULT_KNOWLEDGE_LIMIT;
    // Без слов и фильтров «похожие» не определены: не отдаём всю базу.
    if (limit <= 0 || (words.length === 0 && !category && !building)) return [];

    const hits: SimilarTicket[] = [];
    for (const ticket of this.tickets.values()) {
      if (category && normalizeCategory(ticket.category) !== category) continue;
      const fields = this.fields.get(ticket.id) ?? [];
      const valueOf = (key: string): string => {
        const value = fields.find((field) => field.fieldKey === key)?.value;
        return value === null || value === undefined ? '' : String(value);
      };
      const ticketBuilding = valueOf('building');
      if (building && !ticketBuilding.toLowerCase().includes(building)) continue;

      const symptoms = valueOf('symptoms');
      const object = valueOf('object');
      const score = matchScore(words, [symptoms, object, ticket.category ?? ''].join(' '));
      if (words.length > 0 && score === 0) continue;

      hits.push({
        ticketId: ticket.id,
        number: ticket.number,
        status: ticket.status,
        title: symptoms || object || `Заявка ${ticket.number}`,
        score,
      });
    }
    return hits
      .sort((a, b) => b.score - a.score || a.number.localeCompare(b.number))
      .slice(0, limit);
  }

  async listArticleSteps(ticketId: string): Promise<ArticleStepState[]> {
    return [...this.articleSteps.values()]
      .filter((step) => step.ticketId === ticketId)
      .sort((a, b) => a.articleId.localeCompare(b.articleId) || a.stepIndex - b.stepIndex)
      .map((step) => ({ ...step }));
  }

  async toggleArticleStep(
    ticketId: string,
    articleId: string,
    stepIndex: number,
    done: boolean,
  ): Promise<ArticleStepState> {
    const key = articleStepKey(ticketId, articleId, stepIndex);
    const current = this.articleSteps.get(key);
    // Повтор с тем же значением — не новое действие: время не двигаем.
    if (current && current.done === done) return { ...current };
    const next: ArticleStepState = {
      ticketId,
      articleId,
      stepIndex,
      done,
      updatedAt: new Date().toISOString(),
    };
    this.articleSteps.set(key, next);
    return { ...next };
  }
}

/** Ключ отметки шага в памяти: части разделены `\u0000`, чтобы id не склеивались. */
function articleStepKey(ticketId: string, articleId: string, stepIndex: number): string {
  return [ticketId, articleId, String(stepIndex)].join('\u0000');
}

/** Категории сравниваем без регистра и пробелов по краям. */
function normalizeCategory(category: string | null | undefined): string {
  return (category ?? '').trim().toLowerCase();
}
