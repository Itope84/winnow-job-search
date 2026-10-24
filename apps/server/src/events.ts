import type { EventType, LiveEvent } from '@winnow/api';
import type { Db } from './db.ts';
import { nowIso } from './util.ts';

type Listener = (event: LiveEvent) => void;

const KEEP_EVENTS = 5000;

/** Persistent, replayable event log with in-process fan-out to SSE clients. */
export class EventBus {
  private listeners = new Set<Listener>();
  private sinceTrim = 0;

  constructor(private db: Db) {}

  emit(type: EventType, data: unknown = {}): LiveEvent {
    const at = nowIso();
    const row = this.db
      .prepare('INSERT INTO events (type, at, data) VALUES (?, ?, ?) RETURNING id')
      .get(type, at, JSON.stringify(data)) as { id: number };
    const event: LiveEvent = { id: Number(row.id), type, at, data };
    for (const listener of this.listeners) listener(event);
    if (++this.sinceTrim > 500) this.trim();
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latestId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM events').get() as { id: number | null };
    return Number(row.id ?? 0);
  }

  private trim() {
    this.sinceTrim = 0;
    this.db
      .prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?')
      .run(KEEP_EVENTS);
  }
}
