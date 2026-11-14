import type { StudyPrefs } from '@winnow/api';
import { View } from 'react-native';
import { useCoverage } from '@/lib/hooks';
import { Input, Segmented } from './inputs';
import { ChipInput } from './setup';
import { Field } from './ui';

export const REGIONS = ['Europe', 'Nordics'];

/** Country and region names for the place pickers: regions, then every country Winnow has a card for. */
export function usePlaceNames(chosen: string[] = []): string[] {
  const countries = useCoverage().data?.countries.map((c) => c.facts) ?? [];
  // A chosen region already stands for its countries: don't offer them one by one.
  const regions = new Set(chosen.map((c) => c.toLowerCase()));
  const covered = (region: string, name: string) =>
    regions.has(region.toLowerCase()) || (regions.has('nordics') && NORDICS.includes(name));
  return [
    ...REGIONS.filter((r) => !(regions.has('europe') && r === 'Nordics')),
    ...countries.filter((c) => !covered(c.region, c.name)).map((c) => c.name),
  ];
}

const NORDICS = ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'];

/** Where, what and who: the study wants every scan, triage and score reads. */
export function StudyForm({
  value,
  onChange,
  subjectSuggestions = [],
}: {
  value: StudyPrefs;
  onChange: (v: StudyPrefs) => void;
  /** Subjects AI read off the CV, shown outlined until tapped in. */
  subjectSuggestions?: string[];
}) {
  const used = new Set([...value.places.prefer, ...value.places.allow, ...value.places.exclude]);
  const places = usePlaceNames([...used]);
  const left = places.filter((p) => !used.has(p));
  const set = (patch: Partial<StudyPrefs>) => onChange({ ...value, ...patch });
  const setPlaces = (k: keyof StudyPrefs['places'], v: string[]) =>
    set({ places: { ...value.places, [k]: v } });
  return (
    <View>
      <Field label="Nationality" hint="Most scholarships depend on it.">
        <Input
          value={value.nationality}
          onChangeText={(nationality) => set({ nationality })}
          placeholder="Nigerian"
        />
      </Field>
      <Field label="Degree">
        <Input
          value={value.level}
          onChangeText={(level) => set({ level })}
          placeholder="Master’s"
        />
      </Field>
      <Field label="Programmes or subjects" hint="Best first. Scans and triage match on these.">
        <ChipInput
          values={value.subjects.map((s) => s.title)}
          onChange={(titles) =>
            set({
              subjects: titles.map(
                (title, i) =>
                  value.subjects.find((s) => s.title === title) ?? {
                    title,
                    fit: i === 0 ? 'dream' : 'good',
                  },
              ),
            })
          }
          suggestions={subjectSuggestions}
          placeholder="MSc Molecular Medicine"
        />
      </Field>
      <Field label="Places you’d prefer" hint="Swept first and scored highest.">
        <ChipInput
          values={value.places.prefer}
          onChange={(v) => setPlaces('prefer', v)}
          suggestions={left.slice(0, 8)}
          placeholder="United Kingdom"
        />
      </Field>
      <Field label="Places that are fine">
        <ChipInput
          values={value.places.allow}
          onChange={(v) => setPlaces('allow', v)}
          placeholder="Canada"
        />
      </Field>
      <Field
        label="Never"
        hint="Anything only for these places goes straight to Archive, with the reason."
      >
        <ChipInput
          values={value.places.exclude}
          onChange={(v) => setPlaces('exclude', v)}
          placeholder="United States"
        />
      </Field>
      <Field label="Funding">
        <Segmented
          value={value.fundingNeed}
          onChange={(fundingNeed) => set({ fundingNeed })}
          options={[
            { value: 'any', label: 'Show every level' },
            { value: 'full', label: 'Full funding only' },
          ]}
        />
      </Field>
      <Field label="English test" hint="A test you still need shows as a to-do, not a fail.">
        <Input
          value={value.englishTest}
          onChangeText={(englishTest) => set({ englishTest })}
          placeholder="None yet; degree taught in English; will sit IELTS if asked"
        />
      </Field>
      <Field label="Years of work since graduating">
        <Input
          value={value.workYears ? String(value.workYears) : ''}
          onChangeText={(t) => set({ workYears: Number(t.replace(/[^0-9.]/g, '')) || 0 })}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      </Field>
      <Field label="Start">
        <Input value={value.intake} onChangeText={(intake) => set({ intake })} placeholder="Any" />
      </Field>
      <Field
        label="Anything else a panel should weigh"
        hint="Optional: finances, family, circumstances."
      >
        <Input
          area
          multiline
          value={value.notes}
          onChangeText={(notes) => set({ notes })}
          style={{ minHeight: 80 }}
        />
      </Field>
    </View>
  );
}
