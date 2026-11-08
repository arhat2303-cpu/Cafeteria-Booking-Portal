import type { Response } from 'express';

export interface SseClient {
  id: string;
  userId: number;
  role: string;
  res: Response;
}

class EventHub {
  private clients = new Map<string, SseClient>();

  addClient(client: SseClient): void {
    this.clients.set(client.id, client);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  broadcast(
    eventType: string,
    payload: Record<string, unknown>,
    filter?: { userIds?: number[]; roles?: string[] }
  ): void {
    const message = `event: ${eventType}\ndata: ${JSON.stringify({
      type: eventType,
      timestamp: new Date().toISOString(),
      ...payload,
    })}\n\n`;

    for (const [id, client] of this.clients.entries()) {
      const matchesRole = filter?.roles ? filter.roles.includes(client.role) : false;
      const matchesUser = filter?.userIds ? filter.userIds.includes(client.userId) : false;
      const shouldSend = !filter || matchesRole || matchesUser;

      if (shouldSend) {
        try {
          client.res.write(message);
        } catch {
          this.clients.delete(id);
        }
      }
    }
  }
}

export const eventHub = new EventHub();
