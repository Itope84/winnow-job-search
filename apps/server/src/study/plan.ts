import type { ChecklistItem, Job, OppPlan, PlanTrack, PlanUpdate, Referee } from '@winnow/api';
import { TRACK_STATUSES } from '@winnow/api';
import { type Db, kvGet, kvSet } from '../db.ts';
import type { JobStore } from '../jobs.ts';
import { badRequest, clip, newId } from '../util.ts';

const DEFAULT_DOCS = [
  'Transcript',
  'Degree certificate',
  'CV',
  'Motivation letter',
  'References',
  'English test or English-medium letter',
  'Passport',
];

const key = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** The checklist an application starts with: the page's documents and essays, or the usual ones. */
export function defaultChecklist(job: Job): ChecklistItem[] {
  const o = job.opportunity;
  const docs = o?.documents.length ? o.documents : DEFAULT_DOCS;
  const essays = (o?.essays ?? []).map((e) => `Essay: ${clip(e, 120)}`);
  const seen = new Set<string>();
  return [...docs, ...essays]
    .map((label) => ({ key: key(label), label: clip(label, 160), done: false }))
    .filter((i) => i.key && !seen.has(i.key) && seen.add(i.key));
}

/**
 * The tracks an application follows. A programme has its admission, plus one per scholarship chosen to
 * go with it. A scholarship on its own has its own track; one built into a programme needs only one.
 */
export function buildTracks(
  job: Job,
  fundingIds: string[],
  jobs: JobStore,
  old: PlanTrack[] = [],
): PlanTrack[] {
  const status = (k: string) => old.find((t) => t.key === k)?.status ?? 'to_do';
  const o = job.opportunity;
  const tracks: PlanTrack[] = [];
  if (job.kind === 'programme') {
    tracks.push({
      key: 'admission',
      label: o?.shape === 'built_in' ? 'Application (admission and scholarship)' : 'Admission',
      deadline: o?.deadlines.admission ?? o?.deadlines.scholarship ?? null,
      status: status('admission'),
    });
    for (const id of fundingIds) {
      const s = jobs.get(id);
      if (!s) continue;
      tracks.push({ key: id, label: s.role, deadline: s.due, status: status(id) });
    }
  } else {
    tracks.push({
      key: 'scholarship',
      label: 'Scholarship application',
      deadline: o?.deadlines.scholarship ?? null,
      status: status('scholarship'),
    });
    if (o?.deadlines.admission)
      tracks.push({
        key: 'admission',
        label: 'Admission to the programme',
        deadline: o.deadlines.admission,
        status: status('admission'),
      });
  }
  return tracks;
}

export function updatePlan(jobs: JobStore, id: string, patch: PlanUpdate): OppPlan {
  const job = jobs.require(id);
  if (job.kind === 'job') throw badRequest('Plans are for scholarships and programmes.');
  const cur: OppPlan = job.plan ?? {
    fundingIds: [],
    tracks: [],
    checklist: defaultChecklist(job),
  };
  const fundingIds = Array.isArray(patch.fundingIds)
    ? [
        ...new Set(
          patch.fundingIds.filter(
            (f) => typeof f === 'string' && jobs.get(f)?.kind === 'scholarship',
          ),
        ),
      ].slice(0, 10)
    : cur.fundingIds;
  let tracks = buildTracks(job, fundingIds, jobs, cur.tracks);
  for (const t of patch.tracks ?? []) {
    if (!(TRACK_STATUSES as readonly string[]).includes(t.status))
      throw badRequest('Unknown status.');
    tracks = tracks.map((x) => (x.key === t.key ? { ...x, status: t.status } : x));
  }
  const checklist = Array.isArray(patch.checklist)
    ? patch.checklist
        .filter((i) => i && typeof i.label === 'string' && i.label.trim())
        .slice(0, 40)
        .map((i) => ({
          key: typeof i.key === 'string' && i.key ? clip(i.key, 60) : key(i.label),
          label: clip(i.label.trim(), 160),
          done: i.done === true,
        }))
    : cur.checklist;
  const plan: OppPlan = { fundingIds, tracks, checklist };
  jobs.setPlan(id, plan);
  for (const t of patch.tracks ?? []) {
    const label = tracks.find((x) => x.key === t.key)?.label;
    if (label) jobs.log(id, 'plan', `${label}: ${t.status.replace('_', ' ')}`);
  }
  return plan;
}

export function getReferees(db: Db): Referee[] {
  return kvGet<Referee[]>(db, 'referees', []);
}

export function setReferees(db: Db, v: unknown): Referee[] {
  if (!Array.isArray(v)) throw badRequest('Send a list of referees.');
  const out: Referee[] = (v as Record<string, unknown>[])
    .filter((r) => typeof r?.name === 'string' && r.name.trim())
    .slice(0, 12)
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : newId('ref'),
      name: clip(String(r.name).trim(), 120),
      role: clip(String(r.role ?? '').trim(), 160),
      contact: clip(String(r.contact ?? '').trim(), 160),
      agreed: r.agreed === true,
    }));
  kvSet(db, 'referees', out);
  return out;
}
