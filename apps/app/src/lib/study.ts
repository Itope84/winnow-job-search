import type { FundingLevel, Job, Mode } from '@winnow/api';
import { FUNDING_LABELS } from '@winnow/api';
import type { ChipTone } from '@/components/chips';
import { useMe } from './hooks';

/** What this account looks for. Jobs until the server says otherwise. */
export function useMode(): Mode {
  return useMe().data?.mode ?? 'jobs';
}

/** Words that change with the mode: "job" or "item", "Untitled role" or "Untitled". */
export function nouns(mode: Mode) {
  return mode === 'scholarships'
    ? { one: 'item', many: 'items', untitled: 'Untitled', page: 'page' }
    : { one: 'job', many: 'jobs', untitled: 'Untitled role', page: 'posting' };
}

export function fundingTone(f: FundingLevel): ChipTone {
  if (f === 'full' || f === 'tuition_stipend') return 'sage';
  if (f === 'tuition' || f === 'tuition_free' || f === 'stipend') return 'primary';
  if (f === 'partial') return 'amber';
  return 'neutral';
}

export const fundingLabel = (f: FundingLevel) => FUNDING_LABELS[f];

const dayMs = 86_400_000;

/** The date that matters for a scholarship or programme, with how long is left. */
export function dueLabel(job: Job): { label: string; soon: boolean; past: boolean } | null {
  const d = job.due;
  if (!d) return null;
  const left = Math.round((new Date(`${d}T00:00:00`).getTime() - Date.now()) / dayMs);
  const date = new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: left > 300 ? 'numeric' : undefined,
  });
  if (left < 0) return { label: `Closed ${date}`, soon: false, past: true };
  const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days`;
  return { label: `Due ${date} (${when})`, soon: left <= 14, past: false };
}

/** The meta line under a scholarship or programme in a list. */
export function oppMeta(job: Job): string {
  const o = job.opportunity;
  const due = dueLabel(job);
  const programmes = job.links.filter((l) => l.kind === 'programme').length;
  const ways = job.links.filter((l) => l.kind === 'scholarship').length;
  return [
    due
      ? due.soon
        ? `🔥 ${due.label}`
        : due.label
      : o?.round === 'closed'
        ? 'Between rounds'
        : null,
    job.kind === 'programme' ? o?.university || job.company : job.company,
    o?.countries.length ? o.countries.slice(0, 2).join(', ') : job.location,
    job.kind === 'scholarship' && programmes
      ? `${programmes} programme${programmes === 1 ? '' : 's'}`
      : null,
    job.kind === 'programme' && ways ? `${ways} way${ways === 1 ? '' : 's'} to pay` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
