import type { AddJobRequest, AddJobResult } from '@winnow/api';
import { sourceFromUrl } from './import/parse.ts';
import type { Runner } from './runs/runner.ts';
import { captureJd } from './scan/capture.ts';
import type { Space } from './space.ts';
import { badRequest, nowIso, sha1 } from './util.ts';

const LOGIN_WALLS = /linkedin\.com|indeed\.|glassdoor\./i;

/** Add a job by hand: from a link (read now), or from pasted text. Lands in Inbox unless asked otherwise. */
export async function addJob(
  space: Space,
  runner: Runner,
  req: AddJobRequest,
): Promise<AddJobResult> {
  const url = req.url?.trim();
  const text = req.text?.trim();
  if (!url && !text) throw badRequest('Paste a link or the job description.');
  if (url && !/^https?:\/\/\S+$/.test(url)) throw badRequest('That link doesn’t look right.');

  if (url) {
    const existing = space.jobs.byUrl(url);
    if (existing) return { job: existing, duplicate: true, needsText: false, runId: null };
  }

  let company = req.company?.trim() ?? '';
  let role = req.role?.trim() ?? '';
  let location = req.location?.trim() ?? '';
  let salary: string | null = null;
  let jd = text ?? null;

  if (url && !text) {
    let got = null;
    try {
      got = await captureJd(url);
    } catch {
      got = null;
    }
    // Login-walled sites often redirect to a search page: only a structured job posting counts there.
    const thin =
      !got ||
      got.text.length < 400 ||
      (LOGIN_WALLS.test(url) &&
        got.via !== 'page (structured data)' &&
        got.via !== 'LinkedIn guest page');
    if (thin && !role) {
      // The page can't be read from here (often a login wall): ask for the text instead.
      return {
        job: null,
        duplicate: false,
        needsText: true,
        runId: null,
      };
    }
    if (got) {
      jd = got.text.length >= 120 ? got.text : null;
      company ||= got.company ?? '';
      role ||= cleanTitle(got.title ?? '', company);
      location ||= got.location ?? '';
      salary = got.salary ?? null;
    }
  }
  if (!role) role = firstLine(jd) ?? 'Untitled role';
  if (!company) company = '?';

  const twin = space.jobs.byFingerprint(company, role, location);
  if (twin) {
    if (url) space.jobs.addSource(twin.id, 'added', url);
    return { job: space.jobs.require(twin.id), duplicate: true, needsText: false, runId: null };
  }

  const job = space.jobs.insert({
    url: url ?? `manual:${sha1(`${company}|${role}|${nowIso()}`).slice(0, 16)}`,
    company,
    role,
    location,
    salary,
    source: url ? sourceFromUrl(url) : 'added',
    list: req.then === 'shortlist' ? 'shortlist' : 'inbox',
    movedBy: 'you',
    addedBy: 'you',
    jd,
  });
  let runId: string | null = null;
  // Scoring refuses until there is a CV and profile; the job is still added.
  if (req.then === 'score')
    try {
      runId = runner.enqueue({ kind: 'score', jobIds: [job.id] })[0]?.id ?? null;
    } catch {}
  space.jobs.changed([job.id]);
  return { job: space.jobs.require(job.id), duplicate: false, needsText: false, runId };
}

function cleanTitle(title: string, company: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(/^job application for\s+/i, '').replace(/\s+at\s+[^|–-]+$/i, '');
  for (const sep of [' | ', ' – ', ' - ']) {
    const parts = t.split(sep);
    if (parts.length > 1)
      t =
        parts.find((p) => !company || !p.toLowerCase().includes(company.toLowerCase())) ??
        parts[0] ??
        t;
  }
  return t.trim().slice(0, 160);
}

function firstLine(text: string | null): string | null {
  const line = text
    ?.split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 3 && l.length < 120);
  return line ?? null;
}
