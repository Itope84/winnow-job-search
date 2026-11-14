import type { JobList } from '@winnow/api';
import type { JobStore } from '../jobs.ts';
import type { RunCtx } from '../runs/runner.ts';
import { clip, today } from '../util.ts';
import { postingWarnings, stripHidden } from './guard.ts';

export interface Captured {
  text: string;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  /** The closing date the posting states (YYYY-MM-DD). */
  deadline?: string;
  /** What the posting check found (see guard.ts). */
  warnings?: string[];
  /** How it was read, for the log. */
  via: string;
  /** A closed notice found on a page read leniently (a scholarship between rounds). */
  closed?: string;
}

/** Proof the posting is closed: a 410, a closed notice, a redirect to the job list, a passed deadline. */
export class PostingClosed extends Error {}

/** Lists a closed posting is archived from. Applied jobs keep their place: closing is normal there. */
const CLOSABLE: JobList[] = ['inbox', 'shortlist', 'scored'];

const CLOSED_NOTICE =
  /\b(no longer (available|accepting applications|open|active)|(position|role|vacancy) has been filled|(job|posting|vacancy|position|role) (has )?(expired|closed|been closed|been removed)|(this|the) (job|role|position|vacancy|posting) is (now )?(closed|no longer)|not accepting (new )?applications|applications (are )?(now )?closed)\b/i;

/** A closed notice near the top, or anywhere in a page too short to be a posting. */
export function closedNotice(text: string): string | null {
  const m = CLOSED_NOTICE.exec(text.length < 1500 ? text : text.slice(0, 500));
  return m ? m[0] : null;
}

/**
 * A redirect that lost the posting's id: careers sites send a closed posting to their job list.
 * A sign-in page is not that (the posting may be fine behind it).
 */
export function redirectedToList(from: string, to: string): boolean {
  if (!to || from === to) return false;
  let a: URL;
  let b: URL;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return false;
  }
  if (/(^|\/)(log-?in|sign-?in|auth|sso|authwall|checkpoint)(\/|$|\?)/i.test(b.pathname))
    return false;
  if (/[?&]error=true\b/.test(b.search)) return true;
  const ids =
    a.pathname.match(/\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  return ids.length > 0 && !ids.some((id) => to.includes(id));
}

/** A posting's `validThrough` as YYYY-MM-DD. */
export function deadlineOf(posting: Record<string, unknown> | null): string | undefined {
  const v = posting?.validThrough;
  if (typeof v !== 'string') return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(
  url: string,
  accept = 'text/html,application/json',
  timeoutMs = 20_000,
): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept, 'accept-language': 'en-GB,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 410) throw new PostingClosed('the site says it is gone (HTTP 410)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.redirected && redirectedToList(url, res.url))
    throw new PostingClosed('the link now opens the job list');
  return res;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** HTML to readable text: block tags become line breaks, list items get bullets. Hidden elements go to `hidden`. */
export function htmlToText(markup: string, hidden?: string[]): string {
  const { html, hidden: removed } = stripHidden(markup);
  if (removed.trim()) hidden?.push(removed);
  return decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/section|\/tr)[^>]*>/gi, '\n')
      .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function jsonLdPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1] ?? '') as unknown;
      const items = Array.isArray(data)
        ? data
        : [data, ...(((data as Record<string, unknown>)?.['@graph'] as unknown[]) ?? [])];
      const posting = items.find(
        (d) =>
          d &&
          typeof d === 'object' &&
          /JobPosting/i.test(String((d as Record<string, unknown>)['@type'])),
      );
      if (posting) return posting as Record<string, unknown>;
    } catch {
      // Broken JSON-LD: try the next block.
    }
  }
  return null;
}

function meta(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    'i',
  );
  const v = re.exec(html)?.[1];
  return v ? decode(v).trim() : undefined;
}

function locationOf(posting: Record<string, unknown>): string | undefined {
  const loc = posting.jobLocation as unknown;
  const one = (l: unknown) => {
    const a = (l as { address?: Record<string, unknown> })?.address;
    if (!a) return undefined;
    return [a.addressLocality, a.addressRegion, a.addressCountry]
      .map((x) => (typeof x === 'string' ? x : (x as { name?: string })?.name))
      .filter(Boolean)
      .join(', ');
  };
  const list = (Array.isArray(loc) ? loc : [loc]).map(one).filter(Boolean);
  if (posting.jobLocationType === 'TELECOMMUTE') list.unshift('Remote');
  return list.length ? list.join(' / ') : undefined;
}

/** LinkedIn's public guest endpoint for one posting (no sign-in needed). */
async function viaLinkedIn(url: string, hidden: string[]): Promise<Captured | null> {
  if (!/linkedin\.com\/jobs\/view\//.test(url)) return null;
  const id = /(\d{8,})(?:\/?(?:\?.*)?)$/.exec(url.split('#')[0] ?? '')?.[1];
  if (!id) return null;
  const html = await (
    await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`)
  ).text();
  if (/closed-job__flavor--closed/.test(html))
    throw new PostingClosed('LinkedIn says it is no longer accepting applications');
  const pick = (cls: string) => {
    const m = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<`).exec(html);
    return m?.[1] ? decode(m[1]).replace(/\s+/g, ' ').trim() || undefined : undefined;
  };
  const start = html.indexOf('show-more-less-html__markup');
  const body = start >= 0 ? html.slice(html.indexOf('>', start) + 1) : '';
  const end = body.search(/<button[^>]+show-more-less-html__button|<\/section>/);
  const text = htmlToText(end > 0 ? body.slice(0, end) : body, hidden);
  const title = pick('top-card-layout__title');
  if (!title || text.length < 200) return null;
  return {
    text,
    title,
    company: pick('topcard__org-name-link') ?? pick('topcard__flavor'),
    location: pick('topcard__flavor topcard__flavor--bullet'),
    via: 'LinkedIn guest page',
  };
}

async function viaAts(url: string, hidden: string[]): Promise<Captured | null> {
  const linkedin = await viaLinkedIn(url, hidden);
  if (linkedin) return linkedin;
  const u = new URL(url);
  const gh = /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/.exec(url);
  if (gh) {
    const data = (await (
      await get(
        `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`,
        'application/json',
      )
    ).json()) as {
      content?: string;
      title?: string;
      location?: { name?: string };
      company_name?: string;
    };
    if (data.content)
      return {
        text: htmlToText(decode(data.content), hidden),
        title: data.title,
        company: data.company_name,
        location: data.location?.name,
        via: 'Greenhouse API',
      };
  }
  const lever = /jobs\.(?:eu\.)?lever\.co\/([^/]+)\/([0-9a-f-]{36})/.exec(url);
  if (lever) {
    const host = u.hostname.includes('.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
    const d = (await (
      await get(`https://${host}/v0/postings/${lever[1]}/${lever[2]}`, 'application/json')
    ).json()) as {
      text?: string;
      descriptionPlain?: string;
      lists?: { text?: string; content?: string }[];
      additionalPlain?: string;
      categories?: { location?: string };
    };
    const lists = (d.lists ?? [])
      .map((l) => `## ${l.text ?? ''}\n${htmlToText(l.content ?? '', hidden)}`)
      .join('\n\n');
    return {
      text: [d.descriptionPlain, lists, d.additionalPlain].filter(Boolean).join('\n\n').trim(),
      title: d.text,
      company: lever[1],
      location: d.categories?.location,
      via: 'Lever API',
    };
  }
  const ashby = /jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/.exec(url);
  if (ashby) {
    const d = (await (
      await get(
        `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true`,
        'application/json',
      )
    ).json()) as {
      jobs?: {
        id: string;
        title?: string;
        location?: string;
        descriptionPlain?: string;
        descriptionHtml?: string;
        compensation?: { compensationTierSummary?: string };
      }[];
    };
    const job = d.jobs?.find((j) => j.id === ashby[2]);
    if (job)
      return {
        text: job.descriptionPlain || htmlToText(job.descriptionHtml ?? '', hidden),
        title: job.title,
        company: ashby[1],
        location: job.location,
        salary: job.compensation?.compensationTierSummary,
        via: 'Ashby API',
      };
  }
  return null;
}

async function viaPage(url: string, hidden: string[]): Promise<Captured | null> {
  const html = await (await get(url)).text();
  const posting = jsonLdPosting(html);
  const deadline = deadlineOf(posting);
  if (posting && typeof posting.description === 'string') {
    const org = posting.hiringOrganization as { name?: string } | undefined;
    const base = posting.baseSalary as
      | { currency?: string; value?: { minValue?: number; maxValue?: number } }
      | undefined;
    const salary =
      base?.value?.minValue || base?.value?.maxValue
        ? `${base.currency ?? ''} ${base.value.minValue ?? ''}–${base.value.maxValue ?? ''}`.trim()
        : undefined;
    return {
      text: htmlToText(decode(posting.description), hidden),
      title: typeof posting.title === 'string' ? decode(posting.title) : undefined,
      company: org?.name,
      location: locationOf(posting),
      salary,
      deadline,
      via: 'page (structured data)',
    };
  }
  const main =
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  return {
    text: htmlToText(main, hidden),
    title: meta(html, 'og:title') ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim(),
    company: meta(html, 'og:site_name'),
    via: 'page',
  };
}

let browserPromise: Promise<import('playwright-core').Browser> | null = null;

/** One headless browser for the server, started on first use; null when Playwright isn't installed. */
export async function sharedBrowser(): Promise<import('playwright-core').Browser | null> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return null;
  }
  browserPromise ??= chromium.launch({ headless: true }).catch((e) => {
    browserPromise = null;
    throw e;
  });
  return browserPromise;
}

export const BROWSER_UA = UA;

async function viaBrowser(url: string, hidden: string[]): Promise<Captured | null> {
  const browser = await sharedBrowser();
  if (!browser) return null;
  const page = await browser.newPage({ userAgent: UA });
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (res?.status() === 410) throw new PostingClosed('the site says it is gone (HTTP 410)');
    await page.waitForTimeout(2500);
    if (redirectedToList(url, page.url()))
      throw new PostingClosed('the link now opens the job list');
    const html = await page.content();
    const posting = jsonLdPosting(html);
    // The page's own markup, not innerText: innerText keeps text hidden by opacity, size or position.
    const main =
      /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
    const text =
      posting && typeof posting.description === 'string'
        ? htmlToText(decode(posting.description), hidden)
        : htmlToText(main, hidden);
    return { text, title: await page.title(), deadline: deadlineOf(posting), via: 'browser' };
  } finally {
    await page.close();
  }
}

/** A posting's text after the posting check, with its warnings. */
export function cleanPosting(
  text: string,
  hidden: string[] = [],
): { text: string; warnings: string[] } {
  // Descriptions that arrive with a scan may still be HTML.
  const plain = /<[a-z][^>]*>/i.test(text) ? htmlToText(text, hidden) : text;
  return postingWarnings(plain, hidden.join('\n'));
}

/**
 * Read a posting's description: the ATS API when there is one, then the page, then a headless browser.
 * Throws PostingClosed on proof the posting is closed, and the last error when nothing could be read.
 */
export async function captureJd(
  url: string,
  /** `lenient`: a scholarship page between rounds says "closed" but stays useful; note it, don't throw. */
  opts: { lenient?: boolean } = {},
): Promise<Captured | null> {
  const attempts: ((hidden: string[]) => Promise<Captured | null>)[] = [
    (h) => viaAts(url, h),
    (h) => viaPage(url, h),
    (h) => viaBrowser(url, h),
  ];
  const checked = (got: Captured, hidden: string[]): Captured => {
    const { text, warnings } = cleanPosting(got.text, hidden);
    const notice = closedNotice(text);
    if (notice && !opts.lenient) throw new PostingClosed(`the page says “${notice}”`);
    if (got.deadline && got.deadline < today() && !opts.lenient)
      throw new PostingClosed(`its deadline passed (${got.deadline})`);
    return {
      ...got,
      text: clip(text, 40_000),
      warnings,
      ...(notice ? { closed: notice } : {}),
    };
  };
  let best: { got: Captured; hidden: string[] } | null = null;
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    const hidden: string[] = [];
    try {
      const got = await attempt(hidden);
      if (got?.text && got.text.length >= 400) return checked(got, hidden);
      if (got && (!best || got.text.length > best.got.text.length)) best = { got, hidden };
    } catch (e) {
      if (e instanceof PostingClosed) throw e;
      lastError = e as Error;
    }
  }
  if (best && best.got.text.length >= 120) return checked(best.got, best.hidden);
  if (lastError && !best) throw lastError;
  return best ? checked(best.got, best.hidden) : null;
}

/** Save what a capture read: the text, the facts it adds, and the posting check. */
export function saveCapture(jobs: JobStore, id: string, got: Captured) {
  if (got.text.length >= 120) jobs.writeJd(id, got.text);
  jobs.patchFacts(id, { location: got.location, salary: got.salary ?? null });
  jobs.setPosting(id, {
    warnings: got.warnings ?? [],
    deadline: got.deadline ?? null,
    unreachable: null,
  });
}

/** What a failed capture means for the job: archived when closed, marked unreachable otherwise. */
export function captureFailed(jobs: JobStore, id: string, e: unknown, runId: string | null) {
  const job = jobs.get(id);
  if (!job) return;
  if (e instanceof PostingClosed) {
    if (CLOSABLE.includes(job.list))
      jobs.move(
        { ids: [id], to: 'archive', reason: 'closed', detail: `Posting closed: ${e.message}` },
        'server',
        runId,
      );
    else jobs.log(id, 'posting', `Posting closed: ${e.message}`, runId);
    return;
  }
  jobs.setPosting(id, { unreachable: clip((e as Error).message || 'unknown error', 120) });
}

/** Capture descriptions for several jobs, one at a time with a short gap, inside a scan or capture run. */
export async function captureMany(ctx: RunCtx, ids: string[]) {
  let done = 0;
  for (const id of ids) {
    if (ctx.signal.aborted) return;
    const job = ctx.space.jobs.get(id);
    if (!job) continue;
    try {
      const got = await captureJd(job.url, { lenient: job.kind !== 'job' });
      if (got && got.text.length >= 120) saveCapture(ctx.space.jobs, id, got);
      else ctx.log('info', `No description found for ${job.company} · ${job.role}`);
    } catch (e) {
      ctx.log('stderr', `${job.company} · ${job.role}: ${(e as Error).message}`);
      captureFailed(ctx.space.jobs, id, e, ctx.run.id);
    }
    done++;
    ctx.progress(done, ids.length, 'descriptions');
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function closeBrowser() {
  const b = browserPromise;
  browserPromise = null;
  if (b) await (await b).close().catch(() => {});
}
