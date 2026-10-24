import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, useSourcesDraft, WordList } from '@/components/SourceEditors';
import { Field, Header, Screen, SectionTitle, T } from '@/components/ui';
import { space } from '@/theme';

/** What a scan keeps. Title misses are dropped; location, pay and age misses are archived with the rule. */
export default function Rules() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  const r = draft?.rules;
  return (
    <Screen
      header={<Header title="Rules" />}
      footer={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />}
    >
      {loading || !draft || !r ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            Scans drop jobs whose title matches none of your role words or has an excluded word.
            Jobs that break a location, pay or age rule go to Archive with the rule as the reason,
            so you can check it.
          </T>
          <SectionTitle>Title must include one of</SectionTitle>
          <WordList
            words={r.title.positive}
            placeholder="Add words, separated by commas"
            onChange={(w) =>
              update((s) => ({
                ...s,
                rules: { ...s.rules, title: { ...s.rules.title, positive: w } },
              }))
            }
          />
          <SectionTitle>Title must not include</SectionTitle>
          <WordList
            words={r.title.negative}
            placeholder="Intern, Engineer…"
            onChange={(w) =>
              update((s) => ({
                ...s,
                rules: { ...s.rules, title: { ...s.rules.title, negative: w } },
              }))
            }
          />
          <SectionTitle>Locations always allowed</SectionTitle>
          <WordList
            words={r.location.alwaysAllow}
            placeholder="London, United Kingdom"
            onChange={(w) =>
              update((s) => ({
                ...s,
                rules: { ...s.rules, location: { ...s.rules.location, alwaysAllow: w } },
              }))
            }
          />
          <SectionTitle>Locations allowed</SectionTitle>
          <WordList
            words={r.location.allow}
            placeholder="Remote, EMEA"
            onChange={(w) =>
              update((s) => ({
                ...s,
                rules: { ...s.rules, location: { ...s.rules.location, allow: w } },
              }))
            }
          />
          <SectionTitle>Locations blocked</SectionTitle>
          <WordList
            words={r.location.block}
            placeholder="US Remote"
            onChange={(w) =>
              update((s) => ({
                ...s,
                rules: { ...s.rules, location: { ...s.rules.location, block: w } },
              }))
            }
          />
          <SectionTitle>Pay and age</SectionTitle>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="Minimum pay (yearly)">
                <Input
                  value={r.salary.min ? String(r.salary.min) : ''}
                  onChangeText={(v) =>
                    update((s) => ({
                      ...s,
                      rules: {
                        ...s.rules,
                        salary: { ...s.rules.salary, min: Number(v.replace(/\D/g, '')) || 0 },
                      },
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="0 = no floor"
                />
              </Field>
            </View>
            <View style={{ width: 110 }}>
              <Field label="Currency">
                <Input
                  value={r.salary.currency}
                  onChangeText={(v) =>
                    update((s) => ({
                      ...s,
                      rules: {
                        ...s.rules,
                        salary: { ...s.rules.salary, currency: v.toUpperCase().slice(0, 3) },
                      },
                    }))
                  }
                  autoCapitalize="characters"
                  placeholder="GBP"
                />
              </Field>
            </View>
          </View>
          <Field
            label="Ignore postings older than (days)"
            hint="Full ATS uses this as its window; it defaults to 3 days when empty."
          >
            <Input
              value={r.maxAgeDays ? String(r.maxAgeDays) : ''}
              onChangeText={(v) =>
                update((s) => ({
                  ...s,
                  rules: { ...s.rules, maxAgeDays: Number(v.replace(/\D/g, '')) || null },
                }))
              }
              keyboardType="number-pad"
              placeholder="No limit"
            />
          </Field>
        </View>
      )}
    </Screen>
  );
}
