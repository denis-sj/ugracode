import type { SimilarTicket, TicketHistoryPort } from '@ugra/core';

/** Заглушка истории заявок: похожих заявок нет. */
export class StubTicketHistory implements TicketHistoryPort {
  async similar(_embedding: number[], _limit: number): Promise<SimilarTicket[]> {
    return [];
  }
}
