import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useProfile } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { fonts, space, useTheme } from '@/theme';
import { Input, Segmented } from './inputs';
import { Markdown } from './Markdown';
import { Button, Loading, T } from './ui';

type Field = 'cv' | 'narrative' | 'profileYaml';

/** View or edit one profile document. Markdown shows rendered; YAML stays as text. */
export function DocEditor({
  field,
  hint,
  markdown = true,
}: {
  field: Field;
  hint: string;
  markdown?: boolean;
}) {
  const { c } = useTheme();
  const q = useProfile();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) {
      setText(q.data[field]);
      if (!q.data[field].trim()) setMode('edit');
    }
  }, [q.data, field]);
  if (q.isLoading || !q.data) return <Loading />;
  const dirty = text !== q.data[field];
  const save = async () => {
    setSaving(true);
    try {
      const out = await api.saveProfile({ [field]: text });
      queryClient.setQueryData(keys.profile, out);
      toast.show('Saved');
      setMode('view');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      <T variant="bodySmall" tone="lead">
        {hint}
      </T>
      {markdown ? (
        <Segmented
          value={mode}
          options={[
            { value: 'view', label: 'View' },
            { value: 'edit', label: 'Edit' },
          ]}
          onChange={(v) => setMode(v as 'view' | 'edit')}
        />
      ) : null}
      {mode === 'view' && markdown ? (
        text.trim() ? (
          <Markdown text={text} />
        ) : (
          <T tone="lead">Nothing here yet.</T>
        )
      ) : (
        <Input
          area
          multiline
          value={text}
          onChangeText={setText}
          style={{
            minHeight: 420,
            fontFamily: markdown ? fonts.ui : fonts.mono,
            fontSize: markdown ? 15 : 13,
            lineHeight: 20,
            color: c.ink,
          }}
          autoCapitalize="none"
          autoCorrect={markdown}
        />
      )}
      {dirty ? <Button label="Save" busy={saving} onPress={() => void save()} /> : null}
    </View>
  );
}
