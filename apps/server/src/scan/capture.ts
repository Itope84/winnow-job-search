import type { RunCtx } from '../runs/runner.ts';
import { clip } from '../util.ts';

export interface Captured {
  text: string;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  /** How it was read, for the log. */
  via: string;
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

/** HTML to readable text: block tags become line breaks, list items get bullets. */
export function htmlToText(html: string): string {
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
async function viaLinkedIn(url: string): Promise<Captured | null> {
  if (!/linkedin\.com\/jobs\/view\//.test(url)) return null;
  const id = /(\d{8,})(?:\/?(?:\?.*)?)$/.exec(url.split('#')[0] ?? '')?.[1];
  if (!id) return null;
  const html = await (
    await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`)
  ).text();
  const pick = (cls: string) => {
    const m = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<`).exec(html);
    return m?.[1] ? decode(m[1]).replace(/\s+/g, ' ').trim() || undefined : undefined;
  };
  const start = html.indexOf('show-more-less-html__markup');
  const body = start >= 0 ? html.slice(html.indexOf('>', start) + 1) : '';
  const end = body.search(/<button[^>]+show-more-less-html__button|<\/section>/);
  const text = htmlToText(end > 0 ? body.slice(0, end) : body);
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

async function viaAts(url: string): Promise<Captured | null> {
  const linkedin = await viaLinkedIn(url);
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
        text: htmlToText(decode(data.content)),
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
      .map((l) => `## ${l.text ?? ''}\n${htmlToText(l.content ?? '')}`)
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
        text: job.descriptionPlain || htmlToText(job.descriptionHtml ?? ''),
        title: job.title,
        company: ashby[1],
        location: job.location,
        salary: job.compensation?.compensationTierSummary,
        via: 'Ashby API',
      };
  }
  return null;
}

async function viaPage(url: string): Promise<Captured | null> {
  const html = await (await get(url)).text();
  const posting = jsonLdPosting(html);
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
      text: htmlToText(decode(posting.description)),
      title: typeof posting.title === 'string' ? decode(posting.title) : undefined,
      company: org?.name,
      location: locationOf(posting),
      salary,
      via: 'page (structured data)',
    };
  }
  const main =
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  return {
    text: htmlToText(main),
    title: meta(html, 'og:title') ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim(),
    company: meta(html, 'og:site_name'),
    via: 'page',
  };
}

let browserPromise: Promise<import('playwright-core').Browser> | null = null;

async function viaBrowser(url: string): Promise<Captured | null> {
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
  const browser = await browserPromise;
  const page = await browser.newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    const posting = jsonLdPosting(html);
    const text =
      posting && typeof posting.description === 'string'
        ? htmlToText(decode(posting.description))
        : ((await page.evaluate(
            '(document.querySelector("main") ?? document.body)?.innerText ?? ""',
          )) as string);
    return { text: text.trim(), title: await page.title(), via: 'browser' };
  } finally {
    await page.close();
  }
}

/** Read a posting's description: the ATS API when there is one, then the page, then a headless browser. */
export async function captureJd(url: string): Promise<Captured | null> {
  const attempts: (() => Promise<Captured | null>)[] = [
    () => viaAts(url),
    () => viaPage(url),
    () => viaBrowser(url),
  ];
  let best: Captured | null = null;
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const got = await attempt();
      if (got?.text && got.text.length >= 400) return { ...got, text: clip(got.text, 40_000) };
      if (got && (!best || got.text.length > best.text.length)) best = got;
    } catch (e) {
      lastError = e as Error;
    }
  }
  if (best && best.text.length >= 120) return best;
  if (lastError && !best) throw lastError;
  return best;
}

/** Capture descriptions for several jobs, one at a time with a short gap, inside a scan or capture run. */
export async function captureMany(ctx: RunCtx, ids: string[]) {
  let done = 0;
  for (const id of ids) {
    if (ctx.signal.aborted) return;
    const job = ctx.space.jobs.get(id);
    if (!job) continue;
    try {
      const got = await captureJd(job.url);
      if (got && got.text.length >= 120) {
        ctx.space.jobs.writeJd(id, got.text);
        ctx.space.jobs.patchFacts(id, { location: got.location, salary: got.salary ?? null });
      } else ctx.log('info', `No description found for ${job.company} · ${job.role}`);
    } catch (e) {
      ctx.log('stderr', `${job.company} · ${job.role}: ${(e as Error).message}`);
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
