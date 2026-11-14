import type {
  CreateAppealResponse,
  MetaResponse,
  SessionResponse,
  TicketField,
  TicketListResponse,
  TicketResponse,
  User,
  UsersResponse,
} from '@ugra/contracts';
import type { ApiClient } from '@ugra/ui';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  if (init?.body !== undefined) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'include', headers });
  } catch {
    throw new ApiError('API не отвечает', 0);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // тело не JSON — оставляем код ответа
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface TicketQuery {
  status?: string;
  isEmergency?: boolean;
  limit?: number;
}

function ticketQueryPath(query: TicketQuery = {}): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.isEmergency !== undefined) params.set('isEmergency', String(query.isEmergency));
  params.set('limit', String(query.limit ?? 100));
  return `/api/tickets?${params.toString()}`;
}

/** Клиент API: один на всё приложение, пробрасывается страницам через `WebPageProps`. */
export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),

  meta: (): Promise<MetaResponse> => request<MetaResponse>('/api/meta'),

  users: async (): Promise<User[]> => (await request<UsersResponse>('/api/users')).users,

  session: async (): Promise<User | null> => {
    try {
      const response = await request<SessionResponse>('/api/session');
      return response.user;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 0)) return null;
      throw error;
    }
  },

  signIn: async (userId: string): Promise<User> => {
    const response = await request<SessionResponse>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    return response.user;
  },

  createAppeal: (text: string): Promise<CreateAppealResponse> =>
    request<CreateAppealResponse>('/api/appeals', {
      method: 'POST',
      body: JSON.stringify({ text, channel: 'chat', attachments: [] }),
    }),

  tickets: async (query?: TicketQuery): Promise<TicketListResponse> =>
    request<TicketListResponse>(ticketQueryPath(query)),

  ticket: (id: string): Promise<TicketResponse> => request<TicketResponse>(`/api/tickets/${id}`),

  ticketEvents: (id: string): Promise<{ events: unknown[] }> =>
    request<{ events: unknown[] }>(`/api/tickets/${id}/events`),

  updateField: (ticketId: string, key: string, value: string | number | null): Promise<TicketField> =>
    request<TicketField>(`/api/tickets/${ticketId}/fields/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),

  confirmTicket: (ticketId: string, assigneeId: string): Promise<unknown> =>
    request<unknown>(`/api/tickets/${ticketId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ assigneeId }),
    }),
} satisfies ApiClient & Record<string, unknown>;
