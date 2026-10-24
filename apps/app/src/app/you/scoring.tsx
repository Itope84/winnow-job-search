import type { Settings } from '@winnow/api';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Button, Field, Header, Loading, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';

const DIMS: [string, string][] = [
  ['cv', 'CV match'],
  ['north_star', 'North Star fit'],
  ['comp', 'Comp'],
  ['culture', 'Culture'],
  ['red_flags', 'Red flags'],
];

export default function Scoring() {
  const q = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);
  if (!draft)
    return (
      <Screen header={<Header title="Scoring" />}>
        <Loading />
      </Screen>
    );
  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const save = async () => {
    try {
      const out = await api.saveSettings({ bands: draft.bands, weights: draft.weights });
      queryClient.setQueryData(keys.settings, out);
      toast.show('Saved. New scores use these; existing scores keep their verdicts.');
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  return (
    <Screen header={<Header title="Scoring" />}>
      <View style={{ paddingTop: space.md }}>
        <T variant="bodySmall" tone="lead">
          Every job is scored 1–5 on five dimensions. The overall score is their average, or a
          weighted average if you set weights. The bands turn a score into a verdict.
        </T>
        <SectionTitle>Verdict bands</SectionTitle>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(
            [
              ['applyNow', 'Apply now from'],
              ['apply', 'Apply from'],
              ['maybe', 'Maybe from'],
            ] as const
          ).map(([k, label]) => (
            <View key={k} style={{ flex: 1 }}>
              <Field label={label}>
                <Input
                  value={String(draft.bands[k])}
                  keyboardType="decimal-pad"
                  onChangeText={(v) =>
                    setDraft({ ...draft, bands: { ...draft.bands, [k]: num(v) } })
                  }
                />
              </Field>
            </View>
          ))}
        </View>
        <T variant="meta" tone="faint">
          Below “Maybe” is Skip.
        </T>
        <SectionTitle>Dimension weights</SectionTitle>
        {DIMS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input
              value={draft.weights[k] != null ? String(draft.weights[k]) : ''}
              placeholder="1"
              keyboardType="decimal-pad"
              onChangeText={(v) =>
                setDraft({ ...draft, weights: { ...draft.weights, [k]: num(v) || 1 } })
              }
            />
          </Field>
        ))}
        <Button label="Save" onPress={() => void save()} />
      </View>
    </Screen>
  );
}
