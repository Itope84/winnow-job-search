// Merge directory hits + page discovery into catalogue.json (one record per company id from companies.json).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const rd = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const { sectors, companies } = rd('companies.json');
const hints = rd('hints.json', {});
const ADAPTERS = new Set([
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'successfactors',
  'phenom',
  'radancy',
  'avature',
  'csod',
  'workable',
  'teamtailor',
  'personio',
  'recruitee',
  'bamboohr',
  'breezy',
  'comeet',
  'pinpoint',
  'rippling',
  'softgarden',
  'jibeapply',
  'beesite',
]);
const fps = rd('fingerprints.json', {}),
  extras = rd('extras.json', {});
const dir = rd('directory-hits.json', {}),
  pages = rd('pages.json', {}),
  manual = rd('manual.json', {});
const out = [];
for (const c of companies) {
  const base = { id: c.id, name: c.name, hq: c.hq, sectors: c.sectors };
  const m = manual[c.id];
  const d = dir[c.id]?.hits ?? [];
  const p = pages[c.id];
  let rec;
  if (m) rec = { ...base, ...m };
  else if (d.length) {
    const [best, ...rest] = d;
    rec = {
      ...base,
      status: 'supported',
      portal: best.portal,
      careersUrl: best.url,
      platform: best.portal,
      jobs: best.jobs,
      sample: best.sample,
      source: 'directory',
      alternatives: rest.map((r) => ({ portal: r.portal, careersUrl: r.url, jobs: r.jobs })),
    };
  } else if (extras[c.id]) {
    const e = extras[c.id];
    rec = {
      ...base,
      status: 'supported',
      portal: e.portal,
      careersUrl: e.url,
      platform: e.portal,
      jobs: e.jobs,
      sample: e.sample,
      source: 'careers-page-link',
      alternatives: [],
    };
  } else if (p?.status === 'supported') {
    const [best, ...rest] = p.matches;
    rec = {
      ...base,
      status: 'supported',
      portal: best.portal,
      careersUrl: best.url,
      platform: best.portal,
      jobs: null,
      sample: best.sample,
      source: p.how === 'direct' ? 'careers-page' : 'page-scan',
      alternatives: rest.map((r) => ({ portal: r.portal, careersUrl: r.url })),
    };
  } else if (fps[c.id]?.supported) {
    const f = fps[c.id].supported;
    rec = {
      ...base,
      status: 'supported',
      portal: f.portal,
      careersUrl: f.url,
      platform: f.portal,
      jobs: f.jobs,
      sample: f.sample,
      source: 'careers-page-fingerprint',
      providerHint: true,
      alternatives: [],
    };
  } else if (p?.status === 'unsupported') {
    const fp = (fps[c.id]?.fingerprints ?? []).find((x) =>
      [
        'icims',
        'taleo',
        'oracle-recruiting',
        'eightfold',
        'brassring',
        'jobvite',
        'ukg',
        'workday',
        'greenhouse',
        'lever',
        'ashby',
        'smartrecruiters',
        'avature',
        'csod',
        'radancy',
        'phenom',
        'successfactors',
      ].includes(x),
    );
    rec = {
      ...base,
      status: 'unsupported',
      portal: null,
      careersUrl: p.platformUrl ?? p.page,
      platform: fp ?? p.platform,
      jobs: null,
      sample: [],
      source: 'page-scan',
      careersPage: p.page,
    };
  } else
    rec = {
      ...base,
      status: 'unresolved',
      portal: null,
      careersUrl: null,
      platform: null,
      jobs: null,
      sample: [],
      source: null,
    };
  if (rec.status === 'supported' && hints[c.id]) {
    const h = hints[c.id];
    rec = h.fail
      ? {
          ...rec,
          status: 'unverified',
          careersUrl: pages[c.id]?.page ?? rec.careersUrl,
          jobs: null,
          sample: [],
          note:
            'adapter exists for ' + rec.portal + ' but the feed did not load from the careers page',
        }
      : {
          ...rec,
          portal: h.portal,
          platform: h.portal,
          careersUrl: h.url,
          jobs: h.jobs,
          sample: h.sample,
          providerHint: true,
          source: 'careers-page-fingerprint',
        };
  }
  if (rec.status === 'unsupported' && ADAPTERS.has(rec.platform))
    rec = {
      ...rec,
      status: 'unverified',
      portal: null,
      note: 'platform has a Winnow adapter, but the feed could not be confirmed from the careers page',
    };
  out.push(rec);
}
writeFileSync(
  'catalogue.json',
  JSON.stringify(
    { generated: new Date().toISOString().slice(0, 10), sectors, companies: out },
    null,
    1,
  ),
);
const t = {};
for (const r of out)
  t[r.status + (r.portal ? ':' + r.portal : r.platform ? ':' + r.platform : '')] =
    (t[r.status + (r.portal ? ':' + r.portal : r.platform ? ':' + r.platform : '')] ?? 0) + 1;
console.log(Object.entries(t).sort((a, b) => b[1] - a[1]));
const st = {};
for (const r of out) st[r.status] = (st[r.status] ?? 0) + 1;
console.log(st);
