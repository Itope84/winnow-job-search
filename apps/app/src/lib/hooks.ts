import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type {
  ArchiveReason,
  Job,
  JobList,
  JobQuery,
  MoveRequest,
  Run,
  StartRunRequest,
} from '@winnow/api';
import { ARCHIVE_REASON_LABELS, LIST_LABELS } from '@winnow/api';
import { api } from './api';
import { applyRun, keys, patchJobs, queryClient, refreshJobs } from './query';
import { toast } from './toast';

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 60_000 });
export const useCounts = () => useQuery({ queryKey: keys.counts, queryFn: api.counts });
export const useJob = (id: string | null) =>
  useQuery({ queryKey: keys.job(id ?? ''), queryFn: () => api.job(id as string), enabled: !!id });
export const useActiveRuns = () =>
  useQuery({ queryKey: keys.activeRuns, queryFn: () => api.runs(true), refetchInterval: 20_000 });
export const useRuns = () => useQuery({ queryKey: keys.runs, queryFn: () => api.runs(false) });
export const useRun = (id: string) =>
  useQuery({
    queryKey: keys.run(id),
    queryFn: () => api.run(id),
    refetchInterval: 4000,
    enabled: !!id,
  });
export const useReview = () => useQuery({ queryKey: keys.review, queryFn: api.triageReview });
export const useSources = () => useQuery({ queryKey: keys.sources, queryFn: api.sources });
export const useJobSources = () =>
  useQuery({ queryKey: keys.jobSources, queryFn: api.jobSources, staleTime: 60_000 });
export const useScans = () => useQuery({ queryKey: keys.scans, queryFn: api.scans });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: api.profile });
export const useSetup = () => useQuery({ queryKey: keys.setup, queryFn: api.setup });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useJack = () => useQuery({ queryKey: keys.jack, queryFn: api.jack });
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 60_000 });

export function useJobPages(q: Omit<JobQuery, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: keys.jobList(q),
    queryFn: ({ pageParam }) => api.jobs({ ...q, cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

function stillVisible(job: Job, to: JobList): Job | null {
  // A moved job leaves the list it was in.
  return job.list === to ? job : null;
}

/** Move jobs between lists with an instant update and a 5-second Undo. */
export function useMove() {
  return useMutation({
    mutationFn: (req: MoveRequest & { undoable?: boolean; before?: Job[] }) => api.move(req),
    onMutate: (req) => {
      patchJobs(req.ids, (j) => stillVisible({ ...j, list: req.to }, j.list));
    },
    onSuccess: (_jobs, req) => {
      refreshJobs();
      const n = req.ids.length;
      const what =
        n === 1
          ? req.before?.[0]?.role
            ? `“${clipText(req.before[0].role, 40)}”`
            : '1 job'
          : `${n} jobs`;
      const where =
        req.to === 'archive'
          ? `Archived ${what}${req.reason ? ` · ${ARCHIVE_REASON_LABELS[req.reason as ArchiveReason]}` : ''}`
          : `Moved ${what} to ${LIST_LABELS[req.to]}`;
      const before = req.before;
      toast.show(
        where,
        before && req.undoable !== false
          ? {
              label: 'Undo',
              run: () => {
                const byList = new Map<JobList, string[]>();
                for (const j of before) byList.set(j.list, [...(byList.get(j.list) ?? []), j.id]);
                const restores = [...byList.entries()].map(([list, ids]) =>
                  list === 'archive'
                    ? api.move({
                        ids,
                        to: 'archive',
                        reason: before.find((b) => b.id === ids[0])?.archiveReason ?? 'not_for_me',
                      })
                    : api.move({
                        ids,
                        to: list,
                        stage: before.find((b) => b.id === ids[0])?.stage ?? undefined,
                      }),
                );
                void Promise.all(restores).then(refreshJobs);
              },
            }
          : undefined,
      );
    },
    onError: (e) => {
      refreshJobs();
      toast.show((e as Error).message);
    },
  });
}

/** Move every job triage kept from Inbox to Shortlist, with Undo. */
export function useShortlistKept() {
  return useMutation({
    mutationFn: () => api.shortlistKept(),
    onSuccess: (jobs) => {
      refreshJobs();
      const ids = jobs.map((j) => j.id);
      toast.show(`Shortlisted ${jobs.length} kept job${jobs.length === 1 ? '' : 's'}`, {
        label: 'Undo',
        run: () => void api.move({ ids, to: 'inbox' }).then(refreshJobs),
      });
    },
    onError: (e) => {
      refreshJobs();
      toast.show((e as Error).message);
    },
  });
}

export function useRestore() {
  return useMutation({
    mutationFn: (ids: string[]) => api.restore(ids),
    onMutate: (ids) => patchJobs(ids, () => null),
    onSuccess: (jobs) => {
      refreshJobs();
      toast.show(
        jobs.length === 1
          ? `Restored to ${LIST_LABELS[jobs[0]?.list ?? 'inbox']}`
          : `Restored ${jobs.length} jobs`,
      );
    },
    onError: (e) => {
      refreshJobs();
      toast.show((e as Error).message);
    },
  });
}

export function useStartRun() {
  return useMutation({
    mutationFn: (req: StartRunRequest) => api.startRun(req),
    onSuccess: (runs: Run[]) => {
      for (const r of runs) applyRun(r);
      void queryClient.invalidateQueries({ queryKey: keys.activeRuns });
      refreshJobs();
    },
    onError: (e) => toast.show((e as Error).message),
  });
}

export function clipText(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
