// Step A: match catalogue companies to Greenhouse/Lever/Ashby/Workday directory entries, then confirm with
// Winnow's own provider code. Writes directory-hits.json. Run: node resolve-directories.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadProviders, resolveEntry } from '../../apps/server/src/scan/providers.ts';

const here = new URL('.', import.meta.url).pathname;
const { companies } = JSON.parse(readFileSync(here + 'companies.json', 'utf8'));
const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
const extra: Record<string, string[]> = JSON.parse(
  existsSync(here + 'aliases.json') ? readFileSync(here + 'aliases.json', 'utf8') : '{}',
);

function variants(name: string, id: string): string[] {
  const out = new Set<string>([squash(name)]);
  const stripped = name.replace(
    /\b(group|inc|plc|holdings?|corp(oration)?|company|co|international|technologies|technology|global|the|ltd|limited|ag|se|sa|nv|llc)\b\.?/gi,
    ' ',
  );
  out.add(squash(stripped));
  for (const a of extra[id] ?? []) out.add(squash(a));
  return [...out].filter((v) => v.length >= 3);
}

const dirs: Record<string, string[]> = {};
for (const a of ['greenhouse', 'lever', 'ashby', 'workday'])
  dirs[a] = JSON.parse(readFileSync(`${here}cache/${a}.json`, 'utf8'));
const index = new Map<string, { ats: string; raw: string }[]>();
for (const [ats, list] of Object.entries(dirs))
  for (const raw of list) {
    const slug = squash(ats === 'workday' ? raw.split('|')[0] : raw);
    if (!index.has(slug)) index.set(slug, []);
    index.get(slug)!.push({ ats, raw });
  }

function urlFor(ats: string, raw: string): string {
  if (ats === 'workday') {
    const [t, i, s] = raw.split('|');
    return `https://${t}.${i}.myworkdayjobs.com/${s}`;
  }
  return (
    {
      greenhouse: 'https://job-boards.greenhouse.io/',
      lever: 'https://jobs.lever.co/',
      ashby: 'https://jobs.ashbyhq.com/',
    }[ats]! + raw
  );
}

const { makeHttpCtx } = await loadProviders();
const DENY = new Set(
  JSON.parse(existsSync(here + 'deny.json') ? readFileSync(here + 'deny.json', 'utf8') : '[]'),
); // "companyId|url-substring"
const WEAK =
  /internal|contingent|restricted|confidential|faculty|college|alumni|referral|employee|contractor|agent|acquired|test|sandbox|broadbean/i;

async function workdayTotal(url: string): Promise<number> {
  const m = url.match(/^https:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/);
  if (!m) return 0;
  try {
    const r = await fetch(
      `https://${m[1]}.${m[2]}.myworkdayjobs.com/wday/cxs/${m[1]}/${m[3]}/jobs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!r.ok) return 0;
    return ((await r.json()) as any).total ?? 0;
  } catch {
    return 0;
  }
}

async function load(url: string, name: string) {
  const entry = { name, careers_url: url, max_pages: 1 } as any;
  const hit = await resolveEntry(entry);
  if ('error' in hit) return null;
  let timer: any;
  try {
    const offers: any = await Promise.race([
      hit.provider.fetch(entry, makeHttpCtx()),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), 25_000);
      }),
    ]);
    const arr = Array.isArray(offers) ? offers : [];
    return {
      provider: hit.provider.id,
      firstPage: arr.length,
      sample: arr.slice(0, 3).map((o: any) => String(o.title ?? '').trim()),
      locations: arr.slice(0, 3).map((o: any) => String(o.location ?? '').trim()),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const outFile = here + 'directory-hits.json';
const RE = process.env.RECHECK === '1';
const done: Record<string, any> = RE ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const todo = RE
  ? companies.filter((c: any) => done[c.id]?.candidates > 0 && !done[c.id].hits.length)
  : [...companies];
let n = 0;
async function worker() {
  while (todo.length) {
    const c = todo.shift();
    const cands: { ats: string; raw: string }[] = [];
    for (const v of variants(c.name, c.id))
      for (const h of index.get(v) ?? [])
        if (!cands.some((x) => x.ats === h.ats && x.raw === h.raw)) cands.push(h);
    const results: any[] = [];
    for (const h of cands) {
      const url = urlFor(h.ats, h.raw);
      if ([...DENY].some((d: any) => d === c.id + '|' + url || d === c.id + '|*')) continue;
      const total = h.ats === 'workday' ? await workdayTotal(url) : -1;
      if (total === 0) continue;
      let r = await load(url, c.name);
      if (!r && RE) {
        await new Promise((x) => setTimeout(x, 3000));
        r = await load(url, c.name);
      }
      if (!r || r.firstPage === 0) continue;
      results.push({
        url,
        portal: r.provider,
        jobs: total >= 0 ? total : r.firstPage,
        weak: WEAK.test(url),
        sample: r.sample,
        locations: r.locations,
      });
    }
    results.sort((a, b) => Number(a.weak) - Number(b.weak) || b.jobs - a.jobs);
    done[c.id] = { candidates: cands.length, hits: results.slice(0, 4) };
    if (++n % 50 === 0) console.log(n, 'done');
  }
}
await Promise.all(Array.from({ length: RE ? 3 : 8 }, worker));
writeFileSync(outFile, JSON.stringify(done, null, 1));
console.log(
  'companies with a working directory hit:',
  Object.values(done).filter((d: any) => d.hits.length).length,
  'of',
  Object.keys(done).length,
);
process.exit(0);
