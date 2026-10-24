import { useState } from 'react';
import { View } from 'react-native';
import { DocEditor } from '@/components/DocEditor';
import { Segmented } from '@/components/inputs';
import { Header, Screen } from '@/components/ui';
import { space } from '@/theme';

export default function Profile() {
  const [tab, setTab] = useState<'narrative' | 'targets'>('narrative');
  return (
    <Screen header={<Header title="Profile and targets" />}>
      <View style={{ paddingTop: space.md }}>
        <Segmented
          value={tab}
          options={[
            { value: 'narrative', label: 'Who you are' },
            { value: 'targets', label: 'Targets' },
          ]}
          onChange={(v) => setTab(v as typeof tab)}
        />
      </View>
      {tab === 'narrative' ? (
        <DocEditor
          field="narrative"
          hint="Who you are in a few lines, your North Star (the kind of role you want next), and your strongest proof points. Scoring uses this to judge fit."
        />
      ) : (
        <DocEditor
          field="profileYaml"
          markdown={false}
          hint="Target roles and levels, locations, right to work, pay floor and target, languages and deal-breakers, in career-ops profile.yml form. Triage builds its rules from this."
        />
      )}
    </Screen>
  );
}
