type Lane = 'scan' | 'ai';
type Wake = () => void;

interface Waiter {
  who: Wake;
  /** Triage: handed a slot before any ordinary waiter. */
  first: boolean;
}

/**
 * Server-wide cap on concurrent CLI runs per lane. Runners (one per user) that find no free slot queue up
 * and are handed a slot in the order they started waiting, except that priority waiters (triage) go ahead
 * of ordinary ones (scoring, AI search). A released slot goes straight to the next waiter, so it never
 * becomes free for someone else to jump the queue. Nothing running is ever stopped to make room.
 */
export class Slots {
  private used: Record<Lane, number> = { scan: 0, ai: 0 };
  private waiting: Record<Lane, Waiter[]> = { scan: [], ai: [] };
  /** Slots handed to a woken runner that hasn't picked them up yet (they still count as used). */
  private granted: Record<Lane, Set<Wake>> = { scan: new Set(), ai: new Set() };

  constructor(private max: Record<Lane, number>) {}

  /**
   * A slot for `who`: the one it was granted, or a free one if nobody it must defer to is queued.
   * Null when it must wait.
   */
  take(lane: Lane, who: Wake, first = false): (() => void) | null {
    if (this.granted[lane].delete(who)) return this.releaser(lane);
    if (this.used[lane] >= this.max[lane]) return null;
    if (this.waiting[lane].some((w) => w.who !== who && (w.first || !first))) return null;
    this.decline(lane, who);
    this.used[lane]++;
    return this.releaser(lane);
  }

  /** Queue `who` (once) to be woken when a slot is handed to it. Waiting again with `first` moves it up. */
  wait(lane: Lane, who: Wake, first = false) {
    if (this.granted[lane].has(who)) return;
    const queue = this.waiting[lane];
    const at = queue.findIndex((w) => w.who === who);
    if (at >= 0) {
      if (!first || queue[at]?.first) return;
      queue.splice(at, 1);
    }
    if (first) {
      const after = queue.findIndex((w) => !w.first);
      queue.splice(after < 0 ? queue.length : after, 0, { who, first });
    } else queue.push({ who, first });
  }

  /** A woken runner that no longer has work gives its slot back. Does nothing if it was granted none. */
  decline(lane: Lane, who: Wake) {
    const at = this.waiting[lane].findIndex((w) => w.who === who);
    if (at >= 0) this.waiting[lane].splice(at, 1);
    if (this.granted[lane].delete(who)) this.free(lane);
  }

  /**
   * One more priority slot, for a run that can use several at once (triage works on two batches at a
   * time). Resolves with its release, or null if `signal` aborts first.
   */
  extra(lane: Lane, signal: AbortSignal): Promise<(() => void) | null> {
    return new Promise((resolve) => {
      const who: Wake = () => {
        const release = this.take(lane, who, true);
        if (!release) return;
        signal.removeEventListener('abort', onAbort);
        resolve(release);
      };
      const onAbort = () => {
        this.decline(lane, who);
        resolve(null);
      };
      if (signal.aborted) return resolve(null);
      const now = this.take(lane, who, true);
      if (now) return resolve(now);
      this.wait(lane, who, true);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  stats(): Record<Lane, { used: number; max: number; waiting: number }> {
    return {
      scan: { used: this.used.scan, max: this.max.scan, waiting: this.waiting.scan.length },
      ai: { used: this.used.ai, max: this.max.ai, waiting: this.waiting.ai.length },
    };
  }

  private releaser(lane: Lane) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.free(lane);
    };
  }

  private free(lane: Lane) {
    const next = this.waiting[lane].shift();
    if (next) {
      this.granted[lane].add(next.who);
      queueMicrotask(next.who);
    } else this.used[lane]--;
  }
}
