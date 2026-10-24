import type { Run } from '@winnow/api';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { applyRun, keys, queryClient, refreshJobs } from './query';

type StreamStatus = 'idle' | 'connecting' | 'live' | 'down';

export const useLive = create<{ status: StreamStatus; set: (s: StreamStatus) => void }>((set) => ({
  status: 'idle',
  set: (status) => set({ status }),
}));

/**
 * One event stream per app. It only announces changes; whenever the app starts, comes back to the
 * foreground or reconnects, it refetches what's on screen. So nothing depends on the stream staying open.
 */
class EventStream {
  private source: EventSource | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private jobsTimer: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.running || Platform.OS !== 'web' || typeof EventSource === 'undefined') return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.source?.close();
    this.source = null;
    if (this.timer) clearTimeout(this.timer);
    useLive.getState().set('idle');
  }

  /** Back in the foreground: refetch, and reconnect if the stream died while away. */
  resume() {
    void queryClient.invalidateQueries({ type: 'active' });
    if (this.running && useLive.getState().status !== 'live') {
      this.source?.close();
      this.retry = 0;
      this.connect();
    }
  }

  private connect() {
    if (!this.running) return;
    useLive.getState().set('connecting');
    const es = new EventSource('/api/events', { withCredentials: true });
    this.source = es;
    es.addEventListener('hello', () => {
      this.retry = 0;
      useLive.getState().set('live');
      // Anything could have changed while we were away.
      void queryClient.invalidateQueries({ type: 'active' });
    });
    es.addEventListener('run.changed', (e) => {
      const { data } = JSON.parse((e as MessageEvent).data) as { data: { run: Run } };
      applyRun(data.run);
      if (data.run.status === 'succeeded' || data.run.status === 'failed') {
        void queryClient.invalidateQueries({ queryKey: keys.scans });
        void queryClient.invalidateQueries({ queryKey: keys.review });
      }
    });
    es.addEventListener('jobs.changed', () => this.jobsChanged());
    es.addEventListener(
      'sources.changed',
      () => void queryClient.invalidateQueries({ queryKey: keys.sources }),
    );
    es.addEventListener('setup.changed', () => {
      void queryClient.invalidateQueries({ queryKey: keys.setup });
      void queryClient.invalidateQueries({ queryKey: keys.me });
    });
    es.addEventListener(
      'profile.changed',
      () => void queryClient.invalidateQueries({ queryKey: keys.profile }),
    );
    es.onerror = () => {
      es.close();
      if (this.source === es) this.source = null;
      useLive.getState().set('down');
      if (!this.running) return;
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }

  /** Bursts of job changes (a scan adds hundreds) collapse into one refetch. */
  private jobsChanged() {
    if (this.jobsTimer) return;
    this.jobsTimer = setTimeout(() => {
      this.jobsTimer = null;
      refreshJobs();
    }, 600);
  }
}

export const events = new EventStream();

export function watchForeground() {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') events.resume();
  });
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') events.resume();
  };
  if (Platform.OS === 'web' && typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisible);
  return () => {
    sub.remove();
    if (Platform.OS === 'web' && typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisible);
  };
}
