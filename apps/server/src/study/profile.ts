import type { SetupDraft, SetupState, SourceEntry, Sources, StudyPrefs } from '@winnow/api';
import { stringify } from 'yaml';
import type { Space } from '../space.ts';
import { nowIso } from '../util.ts';
import { type CatalogueEntry, catalogueSource } from './data.ts';
import { studyYaml } from './mode.ts';

const keyOf = (e: SourceEntry) => String(e.careers_url ?? e.api ?? e.name).toLowerCase();

/** Add catalogue pages and feeds to Find's sources, skipping any already there. */
export function addCatalogueSources(sources: Sources, picks: CatalogueEntry[]): Sources {
  const have = new Set([...sources.companies, ...sources.boards].map(keyOf));
  const companies = [...sources.companies];
  const boards = [...sources.boards];
  for (const e of picks) {
    const entry = catalogueSource(e);
    if (have.has(keyOf(entry))) continue;
    have.add(keyOf(entry));
    (e.kind === 'feed' ? boards : companies).push(entry);
  }
  return { ...sources, companies, boards };
}

/** Text from a PDF's layout reflowed into paragraphs. */
export function tidyStatement(text: string): string {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/\s*\n\s*/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** Replace the `study:` block of profile.yml, keeping the rest as it is. */
export function writeStudyYaml(space: Space, study: StudyPrefs) {
  const doc = { ...space.profile.parsed(), study: studyYaml(study) };
  const head = space.profile.get().profileYaml.match(/^(#.*\n)+/)?.[0] ?? '';
  space.profile.set({
    profileYaml: `${head}${head ? '\n' : ''}${stringify(doc, { lineWidth: 100 })}`,
  });
}

/** profile.yml for a scholarships account: who they are, what they want to study, their story. */
export function composeStudyProfileYaml(
  state: SetupState,
  d: SetupDraft,
  study: StudyPrefs,
  email: string,
) {
  const a = state.about;
  const doc = {
    candidate: {
      full_name: a.name ?? '',
      email,
      phone: a.phone ?? '',
      location: [a.city, a.country].filter(Boolean).join(', '),
      linkedin: a.linkedin ?? '',
      portfolio_url: a.portfolio ?? '',
    },
    study: studyYaml(study),
    narrative: {
      headline: d.headline,
      story: d.story,
      strengths: d.superpowers,
      proof_points: d.proofPoints.map((p) => ({ name: p.name, detail: p.metric })),
      subject_notes: d.roleNotes,
    },
    language: {
      output: 'en',
      ...(a.languages?.trim() ? { spoken: a.languages } : {}),
    },
  };
  return `# Winnow profile (scholarships), written by setup on ${nowIso().slice(0, 10)}. Edit it in You › Profile.\n\n${stringify(doc, { lineWidth: 100 })}`;
}
