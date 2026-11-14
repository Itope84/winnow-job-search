import { type InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Job, JobDetail, JobPage, Run } from '@winnow/api';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const keys = {
  me: ['me'] as const,
  health: ['health'] as const,
  counts: ['counts'] as const,
  jobs: ['jobs'] as const,
  jobList: (q: object) => ['jobs', 'list', q] as const,
  job: (id: string) => ['job', id] as const,
  runs: ['runs'] as const,
  activeRuns: ['runs', 'active'] as const,
  run: (id: string) => ['run', id] as const,
  review: ['triage-review'] as const,
  sources: ['sources'] as const,
  seen: ['seen-companies'] as const,
  jobFeed: (id: string) => ['job-feed', id] as const,
  jobSources: ['job-sources'] as const,
  scans: ['scans'] as const,
  profile: ['profile'] as const,
  settings: ['settings'] as const,
  setup: ['setup'] as const,
  people: ['people'] as const,
  jack: ['jack'] as const,
  jackOverview: ['jack', 'overview'] as const,
  study: ['study'] as const,
  coverage: ['coverage'] as const,
  catalogue: ['catalogue'] as const,
  referees: ['referees'] as const,
};

const ACTIVE = new Set(['queued', 'running', 'needs_input']);

/** Fold a run from the stream into the run caches. */
export function applyRun(run: Run) {
  queryClient.setQueryData<Run[]>(keys.activeRuns, (old) => {
    if (!old) return old;
    const rest = old.filter((r) => r.id !== run.id);
    return ACTIVE.has(run.status)
      ? [...rest, run].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : rest;
  });
  queryClient.setQueryData<Run[]>(keys.runs, (old) => {
    if (!old) return old;
    const i = old.findIndex((r) => r.id === run.id);
    if (i < 0) return [run, ...old];
    const next = [...old];
    next[i] = run;
    return next;
  });
  queryClient.setQueryData<{ run: Run; log: unknown[] }>(keys.run(run.id), (old) =>
    old ? { ...old, run } : old,
  );
}

/** Update one job everywhere it is cached, without a refetch (used for optimistic moves). */
export function patchJobs(ids: string[], patch: (job: Job) => Job | null) {
  const set = new Set(ids);
  queryClient.setQueriesData<InfiniteData<JobPage>>({ queryKey: ['jobs', 'list'] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => {
        let removed = 0;
        const items = p.items.flatMap((j) => {
          if (!set.has(j.id)) return [j];
          const next = patch(j);
          if (!next) removed++;
          return next ? [next] : [];
        });
        return { ...p, items, total: p.total - removed };
      }),
    };
  });
  for (const id of ids)
    queryClient.setQueryData<JobDetail>(keys.job(id), (old) => {
      if (!old) return old;
      const next = patch(old);
      return next ? ({ ...old, ...next } as JobDetail) : old;
    });
}

export function refreshJobs() {
  void queryClient.invalidateQueries({ queryKey: keys.jobs });
  void queryClient.invalidateQueries({ queryKey: keys.counts });
  void queryClient.invalidateQueries({ queryKey: ['job'] });
  void queryClient.invalidateQueries({ queryKey: keys.review });
}
