import type { Settings } from '@winnow/api';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Input, Segmented } from '@/components/inputs';
import { Button, Field, Header, Loading, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';

export default function SettingsPage() {
  const q = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);
  if (!draft)
    return (
      <Screen header={<Header title="AI and account" />}>
        <Loading />
      </Screen>
    );
  const editable = draft.aiEditable === true;
  const model = (k: keyof Settings['models']) => (
    <Field
      label={{ default: 'Default model', scan: 'AI search', triage: 'Triage', score: 'Scoring' }[k]}
    >
      <Input
        editable={editable}
        value={draft.models[k] ?? ''}
        placeholder={k === 'default' ? 'The CLI’s own default' : 'Uses the default model'}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(v) =>
          setDraft({ ...draft, models: { ...draft.models, [k]: v.trim() || null } })
        }
      />
    </Field>
  );
  const save = async () => {
    try {
      const out = await api.saveSettings({ cli: draft.cli, models: draft.models });
      queryClient.setQueryData(keys.settings, out);
      toast.show('Saved');
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  const changePassword = async () => {
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.show('Password changed. Other devices are signed out.');
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  return (
    <Screen header={<Header title="AI and account" />}>
      <View style={{ paddingTop: space.md }}>
        <SectionTitle>AI command line</SectionTitle>
        <Segmented
          value={draft.cli}
          options={[
            { value: 'opencode', label: 'OpenCode', disabled: !editable },
            { value: 'claude', label: 'Claude Code', disabled: !editable },
          ]}
          onChange={(v) => editable && setDraft({ ...draft, cli: v as Settings['cli'] })}
        />
        <T variant="meta" tone="lead" style={{ marginTop: 6 }}>
          {editable
            ? 'These apply to everyone on this server.'
            : 'Set by the admin for everyone on this server.'}
        </T>
        <T variant="meta" tone="faint" style={{ marginTop: 6 }}>
          OpenCode model names look like provider/model, for example opencode-go/deepseek-v4-flash.
        </T>
        <SectionTitle>Models per task</SectionTitle>
        {model('default')}
        {model('triage')}
        {model('score')}
        {model('scan')}
        {editable ? <Button label="Save AI settings" onPress={() => void save()} /> : null}
        <SectionTitle>Password</SectionTitle>
        <Field label="Current password">
          <Input
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <Input value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
        </Field>
        <Button
          kind="secondary"
          label="Change password"
          disabled={!current || next.length < 10}
          onPress={() => void changePassword()}
        />
      </View>
    </Screen>
  );
}
