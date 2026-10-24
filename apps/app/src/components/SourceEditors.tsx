import type { Sources } from '@winnow/api';
import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useSources } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { fonts, radius, space, type, useTheme } from '@/theme';
import { Input } from './inputs';
import { Button, Icon, IconButton, Loading, T } from './ui';

/** Load the sources once, edit a copy, save on demand. */
export function useSourcesDraft() {
  const q = useSources();
  const [draft, setDraft] = useState<Sources | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data);
  }, [q.data, dirty]);
  const update = (fn: (s: Sources) => Sources) => {
    setDraft((d) => (d ? fn(structuredClone(d)) : d));
    setDirty(true);
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.saveSources(draft);
      queryClient.setQueryData(keys.sources, saved);
      setDirty(false);
      toast.show('Saved');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return { draft, update, save, dirty, saving, loading: q.isLoading };
}

export function SaveBar({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  if (!dirty) return null;
  return (
    <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}>
      <Button label="Save changes" busy={saving} onPress={onSave} />
    </View>
  );
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  onRemove,
  right,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onRemove?: () => void;
  right?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: c.rule,
      }}
    >
      <View style={{ flex: 1, gap: 2, opacity: value ? 1 : 0.55 }}>
        <Text
          style={[type.label, { color: c.ink, fontFamily: fonts.uiSemibold }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.meta, { color: c.lead }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: c.ruleStrong }}
      />
      {onRemove ? (
        <IconButton name="delete-outline" label={`Remove ${title}`} onPress={onRemove} size={36} />
      ) : null}
    </View>
  );
}

/** A list of words as removable chips with an add box. */
export function WordList({
  words,
  onChange,
  placeholder,
}: {
  words: string[];
  onChange: (w: string[]) => void;
  placeholder: string;
}) {
  const { c } = useTheme();
  const [text, setText] = useState('');
  const add = () => {
    const parts = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((w) => !words.some((x) => x.toLowerCase() === w.toLowerCase()));
    if (parts.length) onChange([...words, ...parts]);
    setText('');
  };
  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {words.map((w) => (
          <Pressable
            key={w}
            onPress={() => onChange(words.filter((x) => x !== w))}
            accessibilityLabel={`Remove ${w}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingLeft: 8,
              paddingRight: 4,
              paddingVertical: 4,
              borderRadius: radius.base,
              backgroundColor: c.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink }}>{w}</Text>
            <Icon name="close" size={14} tone="faint" />
          </Pressable>
        ))}
        {!words.length ? (
          <T variant="meta" tone="faint">
            None yet
          </T>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Input
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          onSubmitEditing={add}
          style={{ flex: 1 }}
        />
        <Button kind="secondary" label="Add" onPress={add} disabled={!text.trim()} />
      </View>
    </View>
  );
}

export { Loading };
