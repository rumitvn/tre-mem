import type { ServerResponse } from 'node:http';

/** Events the dashboard reacts to. Payload is small; clients re-fetch on receipt. */
export type SseEventName = 'branch-changed' | 'team-memory-changed' | 'sidecar-changed' | 'hello';

export interface SseEvent {
  event: SseEventName;
  data?: Record<string, unknown>;
}

/**
 * Minimal Server-Sent-Events hub. Holds open `text/event-stream` responses and
 * fans out events to all of them. Dead connections are pruned on write failure.
 */
export class SseHub {
  private clients = new Set<ServerResponse>();

  get size(): number {
    return this.clients.size;
  }

  /** Attach a response as an SSE stream and send the initial `hello`. */
  add(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    this.send(res, { event: 'hello' });
  }

  /** Broadcast an event to every connected client. */
  broadcast(event: SseEvent): void {
    for (const res of this.clients) this.send(res, event);
  }

  private send(res: ServerResponse, event: SseEvent): void {
    try {
      let frame = `event: ${event.event}\n`;
      frame += `data: ${JSON.stringify(event.data ?? {})}\n\n`;
      res.write(frame);
    } catch {
      this.clients.delete(res);
    }
  }

  /** End all streams (server shutdown). */
  closeAll(): void {
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
    this.clients.clear();
  }
}
