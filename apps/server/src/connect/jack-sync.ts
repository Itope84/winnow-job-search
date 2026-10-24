import type {
  JackApplyRequest,
  JackApplyResult,
  JackDraft,
  JackEdit,
  JackEditRequest,
  JackOverview,
} from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import { type Db, kvGet, kvSet } from '../db.ts';
import type { Executor, RunCtx } from '../runs/runner.ts';
import { badRequest, clip, HttpError, nowIso } from '../util.ts';
import { type JackLink, structured } from './jack.ts';

const KV_DRAFT = 'jack_draft';

/** Fields Jack's update tools take, and the fixed values some of them allow. */
const BRIEF_FIELDS = [
  'role_titles',
  'role_areas',
  'seniority_levels',
  'employment_types',
  'locations',
  'work_modes',
  'location_notes',
  'right_to_work_countries',
  'languages',
  'pay',
  'compensation_notes',
  'role_priorities',
  'industries',
  'sectors_notes',
  'technologies',
  'skills_notes',
  'company_profile',
  'target_companies',
  'excluded_role_titles',
  'excluded_industries',
  'excluded_companies',
  'excluded_technologies',
];
const FIXED: Record<string, string[]> = {
  work_modes: ['remote', 'hybrid', 'on_site'],
  role_areas: [
    'software_engineering',
    'data',
    'other_engineering',
    'product',
    'design',
    'operations_strategy',
    'sales_account_management',
    'marketing',
    'people_hr_recruitment',
    'finance_legal_compliance',
  ],
  seniority_levels: ['internship', 'entry', 'junior', 'mid', 'senior', 'expert_leadership'],
  employment_types: ['full_time', 'contract', 'part_time'],
};
const CURRENCIES = ['GBP', 'USD', 'CAD', 'EUR'];
/** Fields that hold a list of strings: typed as comma-separated text on the review screen. */
const LIST_FIELDS = new Set([
  'role_titles',
  'role_areas',
  'seniority_levels',
  'employment_types',
  'locations',
  'work_modes',
  'right_to_work_countries',
  'languages',
  'industries',
  'technologies',
  'target_companies',
  'excluded_role_titles',
  'excluded_industries',
  'excluded_companies',
  'excluded_technologies',
  'skills',
]);
// Experiences and education are only edited in place (descriptions); adding entries is left to LinkedIn.
const PROFILE_FIELDS = [
  'headline',
  'summary',
  'detailed_summary',
  'looking_for',
  'location',
  'skills',
  'experiences',
  'education',
];

type Raw = Record<string, unknown>;

/** A value as the review screen shows it. */
export function asText(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  const o = value as Raw;
  if ('currency' in o)
    return [
      o.currency,
      o.floor ? `floor ${Number(o.floor).toLocaleString('en-GB')}` : '',
      o.target ? `target ${Number(o.target).toLocaleString('en-GB')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  if ('description' in o && Object.keys(o).length === 1) return asText(o.description);
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${asText(v)}`)
    .join('; ');
}

/** Jack's profile, trimmed to what a draft needs: the text fields and each entry's key. */
function profileView(p: Raw): Raw {
  const profile = (p.profile ?? {}) as Raw;
  const entries = (list: unknown) =>
    (Array.isArray(list) ? (list as Raw[]) : []).map((e) => ({
      key: e.key,
      title: e.title ?? e.program,
      company: (e.company as Raw | undefined)?.name ?? e.institution,
      date_from: e.date_from ?? e.date_from_year,
      date_to: e.date_to ?? e.date_to_year ?? null,
      description: e.description ?? '',
    }));
  return {
    headline: profile.headline ?? '',
    summary: profile.summary ?? '',
    detailed_summary: profile.detailed_summary ?? '',
    looking_for: profile.looking_for ?? '',
    location: profile.location ?? '',
    skills: profile.skills ?? [],
    experiences: entries(profile.experiences),
    education: entries(profile.education),
    improvements: p.improvements ?? [],
  };
}

function cleanEdit(
  raw: unknown,
  part: 'brief' | 'profile',
  current: Raw,
  keys: Set<string>,
): JackEdit | null {
  const e = (raw ?? {}) as Raw;
  const field = String(e.field ?? '');
  if (!(part === 'brief' ? BRIEF_FIELDS : PROFILE_FIELDS).includes(field)) return null;
  const op = (['set', 'add', 'remove', 'update'] as const).find((o) => o === e.op) ?? 'set';
  let value = e.value;
  const itemKey = typeof e.item_key === 'string' ? e.item_key : null;
  if (part === 'profile' && (field === 'experiences' || field === 'education')) {
    // Only an existing entry's description changes.
    if (op !== 'update' || !itemKey || !keys.has(itemKey)) return null;
    const d = (value as Raw | null)?.description;
    if (typeof d !== 'string' || !d.trim()) return null;
    value = { description: d.trim() };
  } else if (op === 'update') return null;
  if (FIXED[field]) {
    const allowed = FIXED[field] ?? [];
    const list = (Array.isArray(value) ? value : [value]).filter(
      (v): v is string => typeof v === 'string' && allowed.includes(v),
    );
    if (!list.length) return null;
    value = op === 'set' ? list : list[0];
  }
  if (field === 'pay') {
    const p = (value ?? {}) as Raw;
    const currency = String(p.currency ?? '').toUpperCase();
    const floor = Number(p.floor) || null;
    const target = Number(p.target) || null;
    if (!CURRENCIES.includes(currency) || (!floor && !target)) return null;
    return {
      field,
      op: 'add',
      value: { currency, floor, target },
      itemKey: null,
      before: asText(current.pay && (current.pay as Raw)[currency]) || null,
      after: asText({ currency, floor, target }),
      why: clip(String(e.why ?? ''), 120),
    };
  }
  // Fixed values read as words on the review screen ("software engineering", not software_engineering).
  const after = (FIXED[field] ? asText(value).replace(/_/g, ' ') : asText(value)).trim();
  if (!after) return null;
  let before: unknown = current[field];
  let entry: string | undefined;
  if (itemKey) {
    const found = ((current[field] ?? []) as Raw[]).find((x) => x.key === itemKey);
    before = found?.description;
    entry = [found?.title, found?.company].filter(Boolean).join(' at ') || undefined;
  }
  return {
    field,
    op,
    value,
    itemKey,
    ...(entry ? { entry } : {}),
    before: asText(before).trim() || null,
    after: clip(after, 4000),
    why: clip(String(e.why ?? ''), 120),
  };
}

/** Draft Jack update: an AI reads the Winnow profile and Jack's current profile and brief, and proposes changes. */
export function jackDraft(jack: JackLink): Executor {
  return async (ctx: RunCtx) => {
    const db = ctx.space.db;
    if (!jack.status(db).connected)
      throw new Error('Connect your Jack account first, in You › Jack & Jill.');
    const doc = ctx.space.profile.get();
    if (doc.cv.trim().length < 200 || !doc.profileYaml.trim())
      throw new Error('Winnow needs your CV and profile first. Finish setting up.');
    ctx.step('Reading your Jack profile and search brief');
    const profile = profileView(structured(await jack.call(db, 'get_profile')));
    const briefRaw = structured(await jack.call(db, 'get_search_brief'));
    const brief = (briefRaw.brief ?? {}) as Raw;
    ctx.step('Drafting changes from your Winnow profile');
    const keys = new Set(
      [...(profile.experiences as Raw[]), ...(profile.education as Raw[])].map((e) =>
        String(e.key),
      ),
    );
    const { value } = await runSkill(ctx, {
      skill: 'jack-update',
      input: {
        cvFile: 'cv.md',
        narrativeFile: 'narrative.md',
        profileFile: 'profile.yml',
        jackProfileFile: 'jack-profile.json',
        jackBriefFile: 'jack-brief.json',
      },
      files: {
        'cv.md': doc.cv.slice(0, 40_000),
        'narrative.md': doc.narrative.slice(0, 20_000),
        'profile.yml': doc.profileYaml.slice(0, 20_000),
        'jack-profile.json': JSON.stringify(profile, null, 2),
        'jack-brief.json': JSON.stringify(
          { brief, missing: (briefRaw.completeness as Raw | undefined)?.missing_fields ?? [] },
          null,
          2,
        ),
      },
      task: 'Draft the changes to send to Jack, as the skill says.',
      model: ctx.settings.models.default,
      timeoutMs: 6 * 60_000,
      validate: (v) => {
        const o = (v ?? {}) as Raw;
        if (!Array.isArray(o.brief) || !Array.isArray(o.profile))
          throw new Error('result.json needs "brief" and "profile" lists (either may be empty).');
        return {
          brief: o.brief
            .map((e) => cleanEdit(e, 'brief', brief, keys))
            .filter((e): e is JackEdit => !!e),
          profile: o.profile
            .map((e) => cleanEdit(e, 'profile', profile, keys))
            .filter((e): e is JackEdit => !!e),
        };
      },
      web: false,
    });
    const draft: JackDraft = { runId: ctx.run.id, createdAt: nowIso(), ...value };
    kvSet(db, KV_DRAFT, draft);
    const n = draft.brief.length + draft.profile.length;
    return {
      summary: n ? `Drafted ${n} change${n === 1 ? '' : 's'} for Jack` : 'Jack is up to date',
      result: { brief: draft.brief.length, profile: draft.profile.length },
    };
  };
}

export function getDraft(db: Db): JackDraft | null {
  return kvGet<JackDraft | null>(db, KV_DRAFT, null);
}

export function discardDraft(db: Db) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(KV_DRAFT);
}

export async function overview(jack: JackLink, db: Db): Promise<JackOverview> {
  const connection = jack.status(db);
  if (!connection.connected) return { connection, account: null, draft: null };
  let account: JackOverview['account'] = null;
  try {
    const s = structured(await jack.call(db, 'get_account_status'));
    const profile = (s.profile ?? {}) as Raw;
    const brief = (s.search_brief ?? {}) as Raw;
    account = {
      visible: s.visibility === 'visible',
      profileMissing: (profile.missing_fields as string[] | undefined) ?? [],
      briefEmpty: brief.is_empty === true,
      briefMissing: (brief.missing_fields as string[] | undefined) ?? [],
      radar: (s.radar as Raw | undefined)?.available === true,
    };
  } catch {
    // Jack unreachable: the screen still shows the connection and the draft.
  }
  return { connection: jack.status(db), account, draft: getDraft(db) };
}

const toTool = (e: JackEdit) => ({
  field: e.field,
  op: e.op,
  value: e.value,
  ...(e.itemKey ? { item_key: e.itemKey } : {}),
});

/** Jack's answer to an update: whether it refused (its protected-characteristic check) and why. */
function refusal(result: Raw): string | null {
  if (result.status === 'sanitization_failed' || result.status === 'error')
    return clip(asText(result.feedback ?? result.message ?? result.status), 300);
  return null;
}

/** Send the edits the person ticked. Profile edits go one at a time, so one refusal doesn't block the rest. */
export async function applyDraft(
  jack: JackLink,
  db: Db,
  req: JackApplyRequest,
): Promise<JackApplyResult> {
  const draft = getDraft(db);
  if (!draft) throw badRequest('There is nothing to send. Draft an update first.');
  const pick = (list: JackEdit[], idx: unknown) =>
    (Array.isArray(idx) ? idx : [])
      .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < list.length)
      .map((i) => list[i] as JackEdit);
  const brief = pick(draft.brief, req.brief);
  const profile = pick(draft.profile, req.profile);
  if (!brief.length && !profile.length) throw badRequest('Tick at least one change to send.');
  const failed: JackApplyResult['failed'] = [];
  const sent = new Set<JackEdit>();
  const problems = new Map<JackEdit, string>();
  const send = async (part: 'brief' | 'profile', edits: JackEdit[]) => {
    try {
      const out = structured(
        await jack.call(db, part === 'brief' ? 'update_search_brief' : 'update_profile', {
          edits: edits.map(toTool),
        }),
      );
      const why = refusal(out);
      if (why) {
        failed.push({ part, message: why });
        for (const e of edits) problems.set(e, why);
      } else for (const e of edits) sent.add(e);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'jack_signed_out') throw e;
      const why = clip((e as Error).message, 300);
      failed.push({ part, message: why });
      for (const e of edits) problems.set(e, why);
    }
  };
  if (brief.length) await send('brief', brief);
  for (const e of profile) await send('profile', [e]);
  // What was sent leaves the draft; what failed or wasn't ticked stays for another go.
  const keep = (list: JackEdit[]) =>
    list
      .filter((e) => !sent.has(e))
      .map((e) => (problems.has(e) ? { ...e, problem: problems.get(e) } : e));
  const left: JackDraft = { ...draft, brief: keep(draft.brief), profile: keep(draft.profile) };
  if (left.brief.length + left.profile.length) kvSet(db, KV_DRAFT, left);
  else discardDraft(db);
  return { sent: sent.size, failed, overview: await overview(jack, db) };
}

/** The person rewrote one drafted edit: turn their text back into the value Jack's tool takes. */
export function editDraft(db: Db, req: JackEditRequest): JackDraft {
  const draft = getDraft(db);
  const list = req.part === 'brief' ? draft?.brief : req.part === 'profile' ? draft?.profile : null;
  const edit = list && Number.isInteger(req.index) ? list[req.index] : undefined;
  if (!draft || !list || !edit) throw badRequest('That change is no longer in the draft.');
  const text = String(req.text ?? '').trim();
  if (!text) throw badRequest('Write something, or untick the change instead.');
  let value: unknown;
  if (edit.field === 'experiences' || edit.field === 'education') value = { description: text };
  else if (edit.field === 'pay') {
    const num = (re: RegExp) => Number((re.exec(text)?.[1] ?? '').replace(/[,\s]/g, '')) || null;
    const currency =
      CURRENCIES.find((c) => text.toUpperCase().includes(c)) ??
      String((edit.value as Raw).currency ?? 'GBP');
    const floor = num(/floor\D*([\d,]+)/i);
    const target = num(/target\D*([\d,]+)/i);
    if (!floor && !target)
      throw badRequest('Write the pay like “GBP floor 100,000 target 120,000”.');
    value = { currency, floor, target };
  } else if (LIST_FIELDS.has(edit.field)) {
    let items = text
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const allowed = FIXED[edit.field];
    if (allowed) {
      items = items.map((t) => t.toLowerCase().replace(/[\s-]+/g, '_'));
      const bad = items.filter((t) => !allowed.includes(t));
      if (bad.length)
        throw badRequest(
          `Jack only takes: ${allowed.map((a) => a.replace(/_/g, ' ')).join(', ')}.`,
        );
    }
    if (!items.length) throw badRequest('Write at least one item.');
    value = edit.op === 'add' || edit.op === 'remove' ? items[0] : items;
  } else value = text;
  const after = (FIXED[edit.field] ? asText(value).replace(/_/g, ' ') : asText(value)).trim();
  const { problem: _gone, ...rest } = edit;
  const next: JackEdit = { ...rest, value, after: clip(after, 4000) };
  const updated: JackDraft = {
    ...draft,
    [req.part]: list.map((e, i) => (i === req.index ? next : e)),
  };
  kvSet(db, KV_DRAFT, updated);
  return updated;
}
