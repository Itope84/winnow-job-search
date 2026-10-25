/**
 * The contract between the Winnow server and app. Plain TypeScript types plus the few labels and rules both
 * sides need to agree on (list names, archive reasons, score bands).
 */

// ── Lists, stages and reasons ────────────────────────────────────────────────

export const LISTS = ['inbox', 'shortlist', 'scored', 'applied', 'archive'] as const;
export type JobList = (typeof LISTS)[number];

export const LIST_LABELS: Record<JobList, string> = {
  inbox: 'Inbox',
  shortlist: 'Shortlist',
  scored: 'Scored',
  applied: 'Applied',
  archive: 'Archive',
};

/** Where an applied job stands. Shown as a label, not a list. */
export const STAGES = ['applied', 'responded', 'interview', 'offer', 'hired'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  applied: 'Applied',
  responded: 'Responded',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
};

export const ARCHIVE_REASONS = [
  'triage',
  'rules',
  'low_score',
  'not_for_me',
  'closed',
  'rejected',
  'withdrew',
  'duplicate',
] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  triage: 'Triage: not a fit',
  rules: 'Filtered by your rules',
  low_score: 'Low score',
  not_for_me: 'Not for me',
  closed: 'Closed or expired',
  rejected: 'Rejected',
  withdrew: 'Withdrew',
  duplicate: 'Duplicate',
};

/** Who made the last move. */
export type Mover = 'you' | 'triage' | 'rules' | 'score' | 'scan' | 'import' | 'server';

export type TriageVerdict = 'keep' | 'discard' | 'unsure';

export const TRIAGE_LABELS: Record<TriageVerdict, string> = {
  keep: 'Kept',
  discard: 'Discarded',
  unsure: 'Unsure',
};

export type ScoreVerdict = 'apply_now' | 'apply' | 'maybe' | 'skip';

export const VERDICT_LABELS: Record<ScoreVerdict, string> = {
  apply_now: 'Apply now',
  apply: 'Apply',
  maybe: 'Maybe',
  skip: 'Skip',
};

/** Default score bands. A person can change them in You › Scoring. */
export interface ScoreBands {
  applyNow: number;
  apply: number;
  maybe: number;
}

export const DEFAULT_BANDS: ScoreBands = { applyNow: 4.5, apply: 4.0, maybe: 3.0 };

export function verdictFor(score: number, bands: ScoreBands = DEFAULT_BANDS): ScoreVerdict {
  if (score >= bands.applyNow) return 'apply_now';
  if (score >= bands.apply) return 'apply';
  if (score >= bands.maybe) return 'maybe';
  return 'skip';
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface JobSource {
  /** Provider or origin, for example `greenhouse`, `adzuna`, `ai-search`, `added`, `career-ops`. */
  source: string;
  url: string;
  seenAt: string;
}

export interface TriageResult {
  verdict: TriageVerdict;
  reason: string;
  at: string;
  runId: string | null;
}

export interface ScoreDimension {
  key: string;
  label: string;
  score: number | null;
  note: string;
}

export interface ScoreResult {
  score: number;
  verdict: ScoreVerdict;
  /** One line: the report's verdict sentence. */
  summary: string;
  dimensions: ScoreDimension[];
  hardStops: string[];
  gaps: string[];
  strengths: string[];
  nextStep: string;
  legitimacy: string | null;
  archetype: string | null;
  comp: string | null;
  at: string;
  runId: string | null;
}

/** A run working on this job right now. */
export interface JobActivity {
  runId: string;
  kind: RunKind;
  status: RunStatus;
}

export interface Job {
  id: string;
  url: string;
  company: string;
  role: string;
  location: string;
  workModel: string | null;
  salary: string | null;
  postedAt: string | null;
  firstSeen: string;
  sources: JobSource[];
  list: JobList;
  stage: Stage | null;
  archiveReason: ArchiveReason | null;
  archiveDetail: string | null;
  movedBy: Mover;
  movedAt: string;
  /** The list a restore sends it back to. */
  prevList: JobList | null;
  triage: TriageResult | null;
  score: ScoreResult | null;
  addedBy: 'scan' | 'you' | 'import';
  hasJd: boolean;
  hasReport: boolean;
  notes: string;
  activity: JobActivity | null;
}

export interface TimelineEntry {
  at: string;
  kind: string;
  text: string;
  runId: string | null;
}

export interface JobDetail extends Job {
  timeline: TimelineEntry[];
  jd: string | null;
  report: string | null;
}

export type JobSort = 'newest' | 'score' | 'scoredAt' | 'company';
export const JOB_SORTS: JobSort[] = ['newest', 'score', 'scoredAt', 'company'];
export const JOB_SORT_LABELS: Record<JobSort, string> = {
  newest: 'Newest',
  score: 'Score',
  scoredAt: 'Last scored',
  company: 'Company',
};

export interface JobQuery {
  list: JobList;
  q?: string;
  triage?: TriageVerdict | 'none';
  source?: string;
  withinDays?: number;
  minScore?: number;
  reason?: ArchiveReason;
  stage?: Stage;
  sort?: JobSort;
  cursor?: string;
  limit?: number;
}

export interface JobPage {
  items: Job[];
  nextCursor: string | null;
  total: number;
}

export type ListCounts = Record<JobList, number> & {
  /** Inbox jobs triage kept: what "Shortlist kept" would move. */
  kept: number;
};

export interface MoveRequest {
  ids: string[];
  to: JobList;
  reason?: ArchiveReason;
  detail?: string;
  stage?: Stage;
}

export interface AddJobRequest {
  url?: string;
  text?: string;
  company?: string;
  role?: string;
  location?: string;
  then?: 'inbox' | 'shortlist' | 'score';
}

export interface AddJobResult {
  /** Null only when `needsText` is set. */
  job: Job | null;
  duplicate: boolean;
  /** Set when the page couldn't be read and the person should paste the text. */
  needsText: boolean;
  runId: string | null;
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export const RUN_KINDS = [
  'scan_portals',
  'scan_ats',
  'scan_ai',
  'triage',
  'score',
  'capture',
  'cv_import',
  'profile_prefill',
  'setup_followup',
  'profile_draft',
  'sources_suggest',
  'scan_jack',
  'jack_update',
] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_LABELS: Record<RunKind, string> = {
  scan_portals: 'Portals scan',
  scan_ats: 'Full ATS scan',
  scan_ai: 'AI search',
  triage: 'Triage',
  score: 'Score',
  capture: 'Read posting',
  cv_import: 'Read CV',
  profile_prefill: 'Pre-fill profile',
  setup_followup: 'Follow-up question',
  profile_draft: 'Draft profile',
  sources_suggest: 'Suggest sources',
  scan_jack: 'Jack scan',
  jack_update: 'Draft Jack update',
};

export type RunStatus =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type RunLane = 'scan' | 'ai';

export interface RunProgress {
  done: number;
  total: number;
  unit: string;
}

export interface Run {
  id: string;
  kind: RunKind;
  lane: RunLane;
  status: RunStatus;
  title: string;
  subtitle: string | null;
  jobIds: string[];
  progress: RunProgress | null;
  step: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** One line describing the outcome, for example "Found 312 · 41 new". */
  summary: string | null;
  result: Record<string, unknown> | null;
  costUsd: number | null;
  model: string | null;
  cli: string | null;
  /** Triage runs: whether the person dismissed the review card. */
  reviewed: boolean;
}

export interface RunLogLine {
  seq: number;
  at: string;
  kind: 'step' | 'tool' | 'text' | 'stderr' | 'info';
  text: string;
}

export interface StartRunRequest {
  kind: RunKind;
  jobIds?: string[];
  /** Triage: the whole untriaged inbox when no ids are given. */
  scope?: 'untriaged';
  /** `radarOnly`: a Jack scan that reads Jill roles without searching. `auto`: started by the server. */
  options?: { autoTriage?: boolean; radarOnly?: boolean; auto?: boolean };
  /** CV import: an uploaded file's name in `profile/uploads/` (the server sets this, not the app). */
  upload?: string;
  /** Setup follow-up: which question, and the answer as it stood (the server sets these). */
  question?: string;
  answer?: string;
}

/** What a scan or AI run costs, shown before it starts. */
export interface RunCost {
  paid: boolean;
  estimate: string;
}

export const RUN_COSTS: Record<RunKind, RunCost> = {
  scan_portals: { paid: false, estimate: 'Seconds' },
  scan_ats: { paid: false, estimate: '10–20 min' },
  scan_ai: { paid: true, estimate: 'About 5 min' },
  triage: { paid: true, estimate: 'About 1 min per 20 jobs' },
  score: { paid: true, estimate: 'About 3 min per job' },
  capture: { paid: false, estimate: 'Seconds' },
  cv_import: { paid: true, estimate: 'About 1 min' },
  profile_prefill: { paid: true, estimate: 'About 20 s' },
  setup_followup: { paid: true, estimate: 'About 15 s' },
  profile_draft: { paid: true, estimate: 'About 1 min' },
  sources_suggest: { paid: true, estimate: 'About 2 min' },
  scan_jack: { paid: false, estimate: 'About 2 min' },
  jack_update: { paid: true, estimate: 'About 1 min' },
};

// ── Sources, profile, settings ───────────────────────────────────────────────

/** A company or board entry, in the career-ops `portals.yml` shape so providers read it unchanged. */
export interface SourceEntry {
  name: string;
  enabled?: boolean;
  careers_url?: string;
  api?: string;
  provider?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface SearchQuery {
  name: string;
  query: string;
  enabled: boolean;
}

export interface Rules {
  title: { positive: string[]; negative: string[] };
  location: { alwaysAllow: string[]; allow: string[]; block: string[] };
  salary: { min: number; max: number; currency: string };
  maxAgeDays: number | null;
}

export interface Sources {
  companies: SourceEntry[];
  boards: SourceEntry[];
  queries: SearchQuery[];
  rules: Rules;
}

export interface ProfileDoc {
  /** The CV as Markdown. */
  cv: string;
  /** Who you are, North Star, proof points: free Markdown. */
  narrative: string;
  /** Targets and deal-breakers in career-ops `profile.yml` form, as YAML text. */
  profileYaml: string;
}

export interface Settings {
  cli: 'opencode' | 'claude' | 'replay';
  models: {
    default: string | null;
    scan: string | null;
    triage: string | null;
    score: string | null;
  };
  aiConcurrency: number;
  autoTriage: boolean;
  /** Check Jack every 10 minutes for new Jill roles, and run Jack's searches every 6 hours. */
  jackAuto: boolean;
  bands: ScoreBands;
  weights: Record<string, number>;
  /** Whether this person may change `cli` and `models` (admins only; they apply to everyone). */
  aiEditable?: boolean;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  admin: boolean;
  /** Whether this person has been through setup. Accounts with a CV and profile already count as done. */
  setup: SetupStatus;
}

// ── Setup (onboarding) ───────────────────────────────────────────────────────

export const SETUP_STEPS = ['start', 'cv', 'about', 'want', 'know', 'review', 'sources'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type SetupStatus = 'needed' | 'in_progress' | 'done';

export interface SetupAbout {
  name: string;
  phone: string;
  city: string;
  country: string;
  timezone: string;
  linkedin: string;
  portfolio: string;
  /** Right to work or visa, in the person's words. */
  workRight: string;
}

/** Career-ops' primary, secondary and adjacent. */
export type RoleFit = 'dream' | 'good' | 'stretch';
export const ROLE_FIT_LABELS: Record<RoleFit, string> = {
  dream: 'Dream',
  good: 'Good fit',
  stretch: 'Stretch',
};

export interface SetupRole {
  title: string;
  fit: RoleFit;
}

export type WorkType = 'remote' | 'hybrid' | 'onsite';
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On site',
};

export interface SetupWant {
  roles: SetupRole[];
  level: string;
  workTypes: WorkType[];
  places: string[];
  currency: string;
  salaryTarget: string;
  salaryMin: string;
  dealBreakers: string[];
}

/** The "get to know you" questions: what a CV can't say. Career-ops asks the same in chat. */
export const SETUP_QUESTIONS = [
  {
    key: 'edge',
    text: 'What do you do better than most people in your field?',
    hint: 'The thing colleagues come to you for.',
  },
  {
    key: 'energy',
    text: 'What work energises you, and what drains you?',
    hint: 'Kinds of tasks, teams or places.',
  },
  {
    key: 'best',
    text: 'Your best achievement, with a number if you have one.',
    hint: 'What you did, and what changed because of it.',
  },
  {
    key: 'next',
    text: 'Why are you moving on, and what do you want next?',
    hint: 'This becomes the story employers hear.',
  },
  {
    key: 'links',
    text: 'Links to work you’re proud of.',
    hint: 'Articles, projects, talks, a portfolio. One per line.',
  },
] as const;
export type SetupQuestionKey = (typeof SETUP_QUESTIONS)[number]['key'];

export interface SetupAnswer {
  key: SetupQuestionKey;
  answer: string;
  /** One question AI asked back when the answer was vague, or null when it was clear enough. */
  followUp: string | null;
  followUpAnswer: string;
  /** The follow-up run, while it is working or once it has asked. */
  followUpRun: string | null;
}

/** What AI read off the CV for the forms. Only fills fields the person hasn't typed in. */
export interface SetupPrefill {
  about: Partial<SetupAbout>;
  roles: SetupRole[];
  level: string;
  places: string[];
  workTypes: WorkType[];
  currency: string;
}

export interface ProofPoint {
  name: string;
  metric: string;
}

/** AI's draft of the profile, which the person edits on Review. The server builds profile.yml from it. */
export interface SetupDraft {
  headline: string;
  story: string;
  superpowers: string[];
  proofPoints: ProofPoint[];
  /** One line per target role: why it fits. Keyed by role title. */
  roleNotes: Record<string, string>;
  /** The narrative Markdown triage and scoring read. */
  narrative: string;
}

export interface SetupSuggestions {
  /** Employers a scanner reads directly (free, in every Portals scan). */
  companies: SourceEntry[];
  /** Employers with their own careers site, which only AI search reads. */
  careerSites: SourceEntry[];
  boards: SourceEntry[];
  queries: SearchQuery[];
  titles: { positive: string[]; negative: string[] };
  /** Employers left out because their careers link was dead or wrong. */
  dropped: string[];
}

export interface SetupState {
  status: SetupStatus;
  step: SetupStep;
  about: Partial<SetupAbout>;
  want: Partial<SetupWant>;
  answers: SetupAnswer[];
  prefill: SetupPrefill | null;
  draft: SetupDraft | null;
  suggestions: SetupSuggestions | null;
  /** The latest run of each kind setup started, so the app can show their progress. */
  runs: { cv: string | null; prefill: string | null; draft: string | null; sources: string | null };
  /** Set when setup is reopened from You: Finish replaces today's profile only then. */
  redo: boolean;
  doneAt: string | null;
}

export interface SetupFinishRequest {
  /** Names of the suggested companies (either kind), boards and queries the person kept ticked. */
  companies: string[];
  boards: string[];
  queries: string[];
  /** Start a Portals scan (with triage) straight away. */
  scan: boolean;
}

// ── Connections ──────────────────────────────────────────────────────────────

/** A person's link to their Jack (Jack & Jill) account. */
export interface JackConnection {
  connected: boolean;
  connectedAt: string | null;
  /** Set when the last call to Jack failed, for example because access was revoked on their side. */
  problem: string | null;
}

/** Where to send the person to sign in, and until when the pasted address will work. */
export interface JackStart {
  url: string;
  expiresAt: string;
}

/** One change to send to Jack, in the shape Jack's update tools take, plus words for the review screen. */
export interface JackEdit {
  field: string;
  op: 'set' | 'add' | 'remove' | 'update';
  value: unknown;
  /** The experience or education entry an `update` changes, and its name ("Engineer at Acme"). */
  itemKey: string | null;
  entry?: string;
  /** What the field (or entry) says on Jack now, as text; null when empty. */
  before: string | null;
  /** The new value as text. */
  after: string;
  /** Where it comes from in Winnow, in a few words. */
  why: string;
  /** Why Jack refused it last time it was sent; cleared when the person edits it. */
  problem?: string;
}

/** The person's own wording for one drafted edit, as they typed it on the review screen. */
export interface JackEditRequest {
  part: 'brief' | 'profile';
  index: number;
  text: string;
}

/** Changes drafted from the Winnow profile, waiting for the person to send them. */
export interface JackDraft {
  runId: string | null;
  createdAt: string;
  brief: JackEdit[];
  profile: JackEdit[];
}

/** The Jack screen: the connection, how complete Jack's side is, and any draft. */
export interface JackOverview {
  connection: JackConnection;
  /** Null when Jack couldn't be reached. */
  account: {
    visible: boolean;
    profileMissing: string[];
    briefEmpty: boolean;
    briefMissing: string[];
    radar: boolean;
  } | null;
  draft: JackDraft | null;
}

/** Which drafted edits to send, by their index in the draft's lists. */
export interface JackApplyRequest {
  brief: number[];
  profile: number[];
}

export interface JackApplyResult {
  sent: number;
  /** Edits Jack refused, with its reason (for example its check for protected characteristics). */
  failed: { part: 'brief' | 'profile'; message: string }[];
  overview: JackOverview;
}

export interface Health {
  ok: true;
  name: 'winnow';
  version: string;
  cli: { id: string; installed: boolean; version: string | null };
}

// ── Live events ──────────────────────────────────────────────────────────────

export type EventType =
  | 'jobs.changed'
  | 'run.changed'
  | 'sources.changed'
  | 'profile.changed'
  | 'setup.changed';

export interface LiveEvent {
  id: number;
  type: EventType;
  at: string;
  data: unknown;
}
