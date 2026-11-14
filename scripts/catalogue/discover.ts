// Step B: for companies without a directory hit, find the careers page and the job system behind it.
// Uses Winnow's own find-portal pieces (confirm / lookAtPage / fromPage). Writes pages.json (resumable).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { confirm, fromPage, lookAtPage } from '../../apps/server/src/scan/find-portal.ts';

const here = new URL('.', import.meta.url).pathname;
const { companies } = JSON.parse(readFileSync(here + 'companies.json', 'utf8'));
const hits = JSON.parse(readFileSync(here + 'directory-hits.json', 'utf8'));
const domains: Record<string, string[]> = existsSync(here + 'domains.json')
  ? JSON.parse(readFileSync(here + 'domains.json', 'utf8'))
  : {};
const outFile = here + 'pages.json';
const done: Record<string, any> = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, 'utf8'))
  : {};
const RETRY = process.argv.includes('--retry');

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
const TLD: Record<string, string[]> = {
  UK: ['co.uk'],
  Germany: ['de'],
  France: ['fr'],
  Switzerland: ['ch'],
  Spain: ['es'],
  Italy: ['it'],
  Japan: ['co.jp'],
  India: ['co.in', 'in'],
  Nigeria: ['com.ng'],
  'S. Africa': ['co.za'],
  Canada: ['ca'],
  Australia: ['com.au'],
  Sweden: ['se'],
  Denmark: ['dk'],
  NL: ['nl'],
  Norway: ['no'],
  Finland: ['fi'],
  Ireland: ['ie'],
  China: ['cn'],
  'S. Korea': ['co.kr'],
  UAE: ['ae'],
  Singapore: ['com.sg'],
  Brazil: ['com.br'],
  Belgium: ['be'],
  Austria: ['at'],
  Poland: ['pl'],
};
const PATHS = [
  'https://careers.{d}',
  'https://jobs.{d}',
  'https://www.{d}/careers',
  'https://www.{d}/en/careers',
  'https://{d}/careers',
  'https://www.{d}/jobs',
  'https://www.{d}/en/jobs',
];
const STRIP =
  /\b(group|inc|plc|holdings?|corp(oration)?|company|co|international|technologies|technology|global|the|ltd|limited|ag|se|sa|nv|llc)\b\.?/gi;

function bases(c: any): string[] {
  const set = new Set<string>();
  const names = [c.name, c.name.replace(STRIP, ' ')];
  const tlds = [
    'com',
    ...String(c.hq ?? '')
      .split('/')
      .flatMap((h: string) => TLD[h.trim()] ?? []),
  ];
  for (const n of names) {
    const s = squash(n);
    if (s.length >= 3) for (const t of tlds) set.add(`${s}.${t}`);
  }
  return [...set];
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function answers(url: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': UA, accept: 'text/html' },
    });
    if (r.status >= 400) {
      await r.body?.cancel();
      return null;
    }
    const html = (await r.text()).slice(0, 400_000).toLowerCase();
    if (!squash(html.slice(0, 400_000)).includes(token)) return null;
    return r.url;
  } catch {
    return null;
  }
}

// Job systems Winnow can't read yet, recognised from links/requests, so we can say what blocks us.
const UNSUPPORTED: [string, RegExp][] = [
  ['icims', /\.icims\.com/i],
  ['taleo', /\.taleo\.net/i],
  [
    'oracle-recruiting',
    /oraclecloud\.com\/hcmUI\/CandidateExperience|\.fa\.[a-z0-9.-]*oraclecloud\.com/i,
  ],
  ['eightfold', /\.eightfold\.ai/i],
  ['jobvite', /jobs\.jobvite\.com/i],
  ['ukg', /ultipro\.com|ukg\.net|recruiting\.ultipro/i],
  ['adp', /workforcenow\.adp\.com|recruiting\.adp\.com/i],
  ['brassring', /brassring\.com/i],
  ['workable-embed', /workable\.com/i],
  ['paycom', /paycomonline\.net/i],
  ['dayforce', /dayforcehcm\.com/i],
  ['gem', /jobs\.gem\.com/i],
];

async function one(c: any) {
  const token = squash(c.name.replace(STRIP, ' ')).slice(0, 6) || squash(c.name).slice(0, 6);
  const rec: any = { tried: 0, page: null as string | null };
  let page: string | null = null;
  const manual = domains[c.id] ?? [];
  const urls = [...manual, ...bases(c).flatMap((b) => PATHS.map((p) => p.replace('{d}', b)))];
  rec.tried = urls.length;
  for (let i = 0; i < urls.length && !page; i += 12) {
    const got = await Promise.all(
      urls.slice(i, i + 12).map((u) => answers(u, (domains[c.id] ?? []).includes(u) ? '' : token)),
    );
    page = got.find(Boolean) ?? null; // first in order wins
  }
  if (!page) return { ...rec, status: 'no-page' };
  rec.page = page;
  const direct = await confirm([{ name: c.name, careers_url: page } as any], 'direct').catch(
    () => [],
  );
  if (direct.length)
    return {
      ...rec,
      status: 'supported',
      how: 'direct',
      matches: direct.map((m) => ({
        url: m.entry.careers_url ?? m.entry.api,
        portal: m.provider,
        sample: m.sample,
      })),
    };
  const look = await lookAtPage(page).catch(() => null);
  if (!look)
    return {
      ...rec,
      status: 'unsupported',
      platform: 'unknown',
      note: 'page would not load in browser',
    };
  const found = await confirm(await fromPage(look), 'page').catch(() => []);
  if (found.length)
    return {
      ...rec,
      status: 'supported',
      how: 'page',
      matches: found.map((m) => ({
        url: m.entry.careers_url ?? m.entry.api,
        portal: m.provider,
        sample: m.sample,
      })),
    };
  const blob = look.urls.join(' ');
  const unsup = UNSUPPORTED.find(([, re]) => re.test(blob));
  const link = look.urls.find((u) => unsup?.[1].test(u));
  return {
    ...rec,
    status: 'unsupported',
    platform: unsup?.[0] ?? 'own-site-or-unrecognised',
    platformUrl: link ?? null,
    title: look.title,
  };
}

const todo = companies.filter(
  (c: any) =>
    !hits[c.id]?.hits?.length &&
    (RETRY ? done[c.id]?.status === 'no-page' || !(c.id in done) : !(c.id in done)),
);
console.log('to do', todo.length);
let n = 0;
async function worker() {
  while (todo.length) {
    const c = todo.shift();
    try {
      done[c.id] = await one(c);
    } catch (e) {
      done[c.id] = { status: 'error', note: String(e) };
    }
    if (++n % 10 === 0) {
      writeFileSync(outFile, JSON.stringify(done, null, 1));
      console.log(
        n,
        c.name,
        done[c.id].status,
        done[c.id].platform ?? done[c.id].matches?.[0]?.portal ?? '',
      );
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.WORKERS ?? 8) }, worker));
writeFileSync(outFile, JSON.stringify(done, null, 1));
const tally: Record<string, number> = {};
for (const d of Object.values(done) as any[]) tally[d.status] = (tally[d.status] ?? 0) + 1;
console.log(tally);
process.exit(0);
