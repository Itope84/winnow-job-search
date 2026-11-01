import type {
  AddJobRequest,
  AddJobResult,
  ApplicationFile,
  Health,
  JackApplyRequest,
  JackApplyResult,
  JackConnection,
  JackEditRequest,
  JackOverview,
  JackStart,
  Job,
  JobDetail,
  JobPage,
  JobQuery,
  ListCounts,
  Me,
  MoveRequest,
  ProfileDoc,
  Run,
  RunLogLine,
  Settings,
  SetupDraft,
  SetupFinishRequest,
  SetupState,
  Sources,
  StartRunRequest,
} from '@winnow/api';
import { Platform } from 'react-native';

/**
 * The server serves the app and its API from one address, so on the web the API is just `/api` and the
 * session cookie rides along. A native build would set EXPO_PUBLIC_WINNOW_URL.
 */
const BASE =
  (process.env.EXPO_PUBLIC_WINNOW_URL ?? '').replace(/\/+$/, '') +
  (Platform.OS === 'web' ? '/api' : '/api');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Set by the root layout: what to do when the server says the session is gone. */
let onSignedOut: (() => void) | null = null;
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  // A Blob (an uploaded file) goes as it is; anything else as JSON.
  const raw = typeof Blob !== 'undefined' && init.body instanceof Blob;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(init.method && init.method !== 'GET' ? { 'x-winnow': '1' } : {}),
        ...(init.body !== undefined
          ? {
              'content-type': raw
                ? (init.body as Blob).type || 'application/octet-stream'
                : 'application/json',
            }
          : {}),
        ...init.headers,
      },
      body: raw
        ? (init.body as Blob)
        : init.body !== undefined
          ? JSON.stringify(init.body)
          : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the Winnow server. Check your connection.');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && path !== '/auth/login') onSignedOut?.();
    throw new ApiError(
      res.status,
      err.error ?? 'error',
      err.message ?? `Request failed (${res.status}).`,
    );
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

/** A tailored CV or letter file. `at` keeps the browser from showing an earlier version. */
export const applicationUrl = (jobId: string, file: ApplicationFile, at: string) =>
  `${BASE}/jobs/${encodeURIComponent(jobId)}/application/${file}${qs({ v: at })}`;

export const api = {
  health: () => request<Health>('/health'),
  me: () => request<Me>('/me'),
  login: (username: string, password: string) =>
    request<Me>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', body: {} }),
  invite: (token: string) =>
    request<{ username: string; email: string; name: string }>(`/auth/invite${qs({ token })}`),
  accept: (token: string, password: string) =>
    request<Me>('/auth/accept', { method: 'POST', body: { token, password } }),
  changePassword: (current: string, password: string) =>
    request<{ ok: true }>('/me/password', { method: 'POST', body: { current, password } }),

  jobs: (q: JobQuery) =>
    request<JobPage>(
      `/jobs${qs({
        list: q.list,
        q: q.q,
        triage: q.triage,
        source: q.source,
        within: q.withinDays,
        minScore: q.minScore,
        reason: q.reason,
        stage: q.stage,
        sort: q.sort,
        cursor: q.cursor,
        limit: q.limit,
      })}`,
    ),
  counts: () => request<ListCounts>('/jobs/counts'),
  jobSources: () => request<string[]>('/jobs/sources'),
  job: (id: string) => request<JobDetail>(`/jobs/${encodeURIComponent(id)}`),
  updateJob: (id: string, patch: { notes?: string; stage?: string }) =>
    request<Job>(`/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  move: (req: MoveRequest) => request<Job[]>('/jobs/move', { method: 'POST', body: req }),
  uploadCvPdf: (file: Blob, name: string) =>
    request<Run[]>('/profile/cv/pdf', {
      method: 'POST',
      body: file,
      headers: { 'x-file-name': encodeURIComponent(name) },
    }),
  pasteCv: (text: string) => request<Run[]>('/profile/cv/text', { method: 'POST', body: { text } }),
  shortlistKept: () => request<Job[]>('/jobs/shortlist-kept', { method: 'POST' }),
  restore: (ids: string[]) => request<Job[]>('/jobs/restore', { method: 'POST', body: { ids } }),
  addJob: (req: AddJobRequest) => request<AddJobResult>('/jobs/add', { method: 'POST', body: req }),

  runs: (active = false) => request<Run[]>(`/runs${active ? '?active=1' : ''}`),
  run: (id: string, after = 0) =>
    request<{ run: Run; log: RunLogLine[] }>(`/runs/${id}${qs({ after })}`),
  startRun: (req: StartRunRequest) => request<Run[]>('/runs', { method: 'POST', body: req }),
  cancelRun: (id: string) => request<Run>(`/runs/${id}/cancel`, { method: 'POST', body: {} }),
  retryRun: (id: string) => request<Run[]>(`/runs/${id}/retry`, { method: 'POST', body: {} }),
  resumeRun: (id: string) => request<Run>(`/runs/${id}/resume`, { method: 'POST', body: {} }),
  dismissRun: (id: string) => request<Run>(`/runs/${id}/dismiss`, { method: 'POST', body: {} }),
  triageReview: () => request<{ run: Run; archived: Job[] } | null>('/triage/review'),

  sources: () => request<Sources>('/sources'),
  saveSources: (s: Sources) => request<Sources>('/sources', { method: 'PUT', body: s }),
  checkSource: (entry: { name?: string; careers_url?: string }) =>
    request<{ ok: boolean; provider?: string; message?: string }>('/sources/check', {
      method: 'POST',
      body: entry,
    }),
  scans: () => request<Run[]>('/scans'),

  profile: () => request<ProfileDoc & { ready: { cv: boolean; profile: boolean } }>('/profile'),
  addExtra: (text: string) =>
    request<ProfileDoc & { ready: { cv: boolean; profile: boolean } }>('/profile/extras', {
      method: 'POST',
      body: { text },
    }),
  saveProfile: (p: Partial<ProfileDoc>) =>
    request<ProfileDoc & { ready: { cv: boolean; profile: boolean } }>('/profile', {
      method: 'PUT',
      body: p,
    }),
  setup: () => request<SetupState>('/setup'),
  startSetup: (redo = false) =>
    request<SetupState>('/setup/start', { method: 'POST', body: { redo } }),
  saveSetup: (patch: Record<string, unknown>) =>
    request<SetupState>('/setup', { method: 'PUT', body: patch }),
  followUp: (question: string) =>
    request<SetupState>('/setup/followup', { method: 'POST', body: { question } }),
  draftProfile: () => request<SetupState>('/setup/draft', { method: 'POST', body: {} }),
  suggestSources: () => request<SetupState>('/setup/sources', { method: 'POST', body: {} }),
  confirmProfile: (draft: SetupDraft) =>
    request<SetupState>('/setup/confirm', { method: 'POST', body: { draft } }),
  finishSetup: (req: SetupFinishRequest) =>
    request<{ setup: SetupState; runs: Run[] }>('/setup/finish', { method: 'POST', body: req }),
  settings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PATCH', body: s }),

  jack: () => request<JackConnection>('/connections/jack'),
  jackStart: () => request<JackStart>('/connections/jack/start', { method: 'POST', body: {} }),
  jackFinish: (url: string) =>
    request<JackConnection>('/connections/jack/finish', { method: 'POST', body: { url } }),
  jackDisconnect: () => request<JackConnection>('/connections/jack', { method: 'DELETE' }),
  jackOverview: () => request<JackOverview>('/connections/jack/overview'),
  jackDraft: () => request<Run[]>('/connections/jack/draft', { method: 'POST', body: {} }),
  jackEditDraft: (req: JackEditRequest) =>
    request<JackOverview>('/connections/jack/draft', { method: 'PUT', body: req }),
  jackDiscard: () => request<JackOverview>('/connections/jack/draft', { method: 'DELETE' }),
  jackApply: (req: JackApplyRequest) =>
    request<JackApplyResult>('/connections/jack/apply', { method: 'POST', body: req }),

  people: () =>
    request<
      {
        id: string;
        email: string;
        name: string;
        admin: boolean;
        disabled: boolean;
        hasPassword: boolean;
      }[]
    >('/admin/users'),
  addPerson: (p: { id: string; email: string; name: string }) =>
    request<{ invite: string }>('/admin/users', { method: 'POST', body: p }),
  reinvite: (id: string) =>
    request<{ invite: string }>(`/admin/users/${id}/invite`, { method: 'POST', body: {} }),
};

export function inviteLink(token: string) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return `${origin}/welcome?invite=${encodeURIComponent(token)}`;
}
