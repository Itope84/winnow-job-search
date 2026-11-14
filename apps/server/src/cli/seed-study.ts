/**
 * Seed a scholarships account from files, with no AI: for setting someone up by hand.
 *
 *   pnpm --filter @winnow/server exec tsx src/cli/seed-study.ts <id> <folder> [--demo]
 *
 * <folder> holds cv.md, statement.md, narrative.md and study.json (StudyPrefs), plus optional
 * about.json ({ name, email, phone, city, country, headline, story }) and queries.json (AI searches). Sets the mode, saves the
 * profile, adds every catalogue page and feed that fits, and marks setup done. `--demo` also adds a
 * few sample scholarships and programmes (for screenshots on a scratch library, never a real one).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StudyPrefs } from '@winnow/api';
import { stringify } from 'yaml';
import { loadConfig, loadDotEnv } from '../config.ts';
import { getSources, setSources } from '../library.ts';
import { saveSetup } from '../setup.ts';
import { openSpace } from '../space.ts';
import { catalogue, entryFits } from '../study/data.ts';
import { setMode, setStudy, studyYaml } from '../study/mode.ts';
import { autoLink, seedOpportunity } from '../study/opportunity.ts';
import { addCatalogueSources } from '../study/profile.ts';
import { nowIso } from '../util.ts';

loadDotEnv();
const [id, folder, ...flags] = process.argv.slice(2);
if (!id || !folder) {
  console.error('Usage: seed-study.ts <id> <folder> [--demo]');
  process.exit(1);
}
const read = (f: string) =>
  existsSync(join(folder, f)) ? readFileSync(join(folder, f), 'utf8') : '';
const config = loadConfig();
const space = openSpace(config.usersDir, id);
const about = JSON.parse(read('about.json') || '{}') as Record<string, string>;

setMode(space.db, 'scholarships');
const study = setStudy(space.db, JSON.parse(read('study.json')) as Partial<StudyPrefs>);
const profileYaml = `# Winnow profile (scholarships), seeded on ${nowIso().slice(0, 10)}. Edit it in You › Profile.\n\n${stringify(
  {
    candidate: {
      full_name: about.name ?? '',
      email: about.email ?? '',
      phone: about.phone ?? '',
      location: [about.city, about.country].filter(Boolean).join(', '),
    },
    study: studyYaml(study),
    narrative: { headline: about.headline ?? '', story: about.story ?? '' },
    language: { output: 'en' },
  },
  { lineWidth: 100 },
)}`;
space.profile.set({
  cv: read('cv.md'),
  statement: read('statement.md'),
  narrative: read('narrative.md'),
  profileYaml,
});

const fitting = catalogue().filter((e) => entryFits(e, study));
const sources = addCatalogueSources(getSources(space.db), fitting);
const queries = JSON.parse(read('queries.json') || '[]') as string[];
setSources(space.db, {
  ...sources,
  queries: [
    ...sources.queries,
    ...queries
      .filter((q) => !sources.queries.some((x) => x.query === q))
      .map((q) => ({ name: q, query: q, enabled: true })),
  ],
});
saveSetup(space, {
  status: 'done',
  doneAt: nowIso(),
  mode: 'scholarships',
  about: {
    name: about.name,
    phone: about.phone,
    city: about.city,
    country: about.country,
    nationality: study.nationality,
  },
  want: { roles: study.subjects, level: study.level },
});
console.log(`${id}: scholarships mode, profile saved, ${fitting.length} catalogue sources added.`);

if (flags.includes('--demo')) {
  const add = (
    url: string,
    role: string,
    company: string,
    kind: 'scholarship' | 'programme',
    facts: Parameters<typeof seedOpportunity>[1],
    list: 'inbox' | 'scored' = 'inbox',
  ) => {
    const opp = seedOpportunity(kind, facts);
    const j = space.jobs.insert({
      url,
      role,
      company,
      location: opp.countries.join(', '),
      source: 'demo',
      list,
      movedBy: 'scan',
      addedBy: 'scan',
      kind,
      opportunity: opp,
    });
    return j.id;
  };
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  add(
    'https://demo.example/edinburgh-msc',
    'MSc Biomedical Sciences',
    'University of Edinburgh',
    'programme',
    {
      university: 'University of Edinburgh',
      countries: ['United Kingdom'],
      funding: 'fees',
      tuition: '£36,000 a year for international students',
      length: '1 year',
      deadlines: { scholarship: null, admission: day(120) },
    },
  );
  add(
    'https://demo.example/glasgow-msc',
    'MSc Medical Genetics and Genomics',
    'University of Glasgow',
    'programme',
    {
      university: 'University of Glasgow',
      countries: ['United Kingdom'],
      funding: 'fees',
      deadlines: { scholarship: null, admission: day(95) },
    },
  );
  const mc = add(
    'https://demo.example/mastercard',
    'Mastercard Foundation Scholars Program',
    'Mastercard Foundation',
    'scholarship',
    {
      shape: 'many_schools',
      funding: 'full',
      covers: 'Tuition, living costs, flights, laptop',
      countries: ['United Kingdom', 'Canada'],
      schools: ['University of Edinburgh', 'University of Toronto', 'McGill University'],
      deadlines: { scholarship: day(10), admission: null },
      round: 'open',
      eligibility: {
        status: 'eligible',
        who: 'Young Africans with financial need',
        fails: [],
        todos: ['IELTS 6.5, or a letter that your degree was taught in English'],
      },
    },
  );
  add(
    'https://demo.example/daad',
    'DAAD Development-Related Postgraduate Courses',
    'DAAD',
    'scholarship',
    {
      shape: 'country',
      funding: 'full',
      countries: ['Germany'],
      deadlines: { scholarship: null, admission: null },
      round: 'closed',
      eligibility: {
        status: 'ineligible',
        who: 'Two years’ work experience',
        fails: ['Needs 2 years’ work; you have about 1'],
        todos: [],
      },
    },
  );
  add(
    'https://demo.example/lmu',
    'MSc Molecular Medicine',
    'Ludwig Maximilian University of Munich',
    'programme',
    {
      university: 'Ludwig Maximilian University of Munich',
      countries: ['Germany'],
      funding: 'tuition_free',
      tuition: 'No tuition; about €150 a semester in fees',
      deadlines: { scholarship: null, admission: day(45) },
    },
  );
  add(
    'https://demo.example/eth',
    'ETH Excellence Scholarship & Opportunity Programme',
    'ETH Zurich',
    'scholarship',
    {
      shape: 'one_school',
      university: 'ETH Zurich',
      funding: 'tuition_stipend',
      countries: ['Switzerland'],
      deadlines: { scholarship: day(30), admission: day(30) },
      round: 'open',
    },
  );
  for (const j of space.jobs.query({ list: 'inbox', limit: 50 }).items) autoLink(space.jobs, j.id);
  console.log(`Added demo items; Mastercard links: ${space.jobs.require(mc).links.length}.`);
}
space.db.close();
