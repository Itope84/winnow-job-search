import { MaterialIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRun } from '@/lib/hooks';
import { fonts, hit, radius, space, useTheme } from '@/theme';
import { Input } from './inputs';
import { Button, T } from './ui';

/** Setup's progress: one short segment per step, the ones done filled in. */
export function StepBar({ at, of }: { at: number; of: number }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${at} of ${of}`}
      style={{ flexDirection: 'row', gap: 4, paddingHorizontal: space.md, paddingBottom: space.sm }}
    >
      {Array.from({ length: of }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: i < at ? c.primary : c.rule,
          }}
        />
      ))}
    </View>
  );
}

/** A small teal label beside a field AI filled in from the CV. Goes once the person edits it. */
export function FromCv() {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <MaterialIcons name="auto-awesome" size={11} color={c.primaryInk} />
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 11.5, color: c.primaryInk }}>
        From your CV
      </Text>
    </View>
  );
}

/** A field label with an optional "From your CV" tag. */
export function SetupField({
  label,
  fromCv,
  hint,
  children,
}: {
  label: string;
  fromCv?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 6, marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <T variant="caps" tone="lead">
          {label}
        </T>
        {fromCv ? <FromCv /> : null}
      </View>
      {children}
      {hint ? (
        <T variant="meta" tone="faint">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** A tappable chip: filled when on, outlined (with a plus) when it is only a suggestion. */
export function ToggleChip({
  label,
  on,
  onPress,
  onRemove,
}: {
  label: string;
  on: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onRemove ?? onPress}
      accessibilityRole="button"
      accessibilityLabel={onRemove ? `Remove ${label}` : on ? `${label}, selected` : `Add ${label}`}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: on ? c.ink : c.ruleStrong,
          backgroundColor: on ? c.ink : pressed ? c.surface : 'transparent',
          borderStyle: on ? 'solid' : 'dashed',
        },
      ]}
    >
      {!on ? <MaterialIcons name="add" size={14} color={c.lead} /> : null}
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13.5, color: on ? c.canvas : c.ink }}>
        {label}
      </Text>
      {onRemove ? <MaterialIcons name="close" size={14} color={c.canvas} /> : null}
    </Pressable>
  );
}

/** Words as chips: type and press Enter to add; suggestions show outlined until tapped in. */
export function ChipInput({
  values,
  onChange,
  suggestions = [],
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.toLowerCase());
  const add = (v: string) => {
    const t = v.trim();
    if (t && !has(t)) onChange([...values, t]);
    setText('');
  };
  const left = suggestions.filter((s) => !has(s));
  return (
    <View style={{ gap: space.sm }}>
      {values.length || left.length ? (
        <View style={styles.wrap}>
          {values.map((v) => (
            <ToggleChip
              key={v}
              label={v}
              on
              onRemove={() => onChange(values.filter((x) => x !== v))}
            />
          ))}
          {left.map((v) => (
            <ToggleChip key={`s-${v}`} label={v} on={false} onPress={() => add(v)} />
          ))}
        </View>
      ) : null}
      <Input
        value={text}
        onChangeText={(t) => (t.endsWith(',') ? add(t.slice(0, -1)) : setText(t))}
        onSubmitEditing={() => add(text)}
        onBlur={() => add(text)}
        placeholder={placeholder}
        returnKeyType="done"
        blurOnSubmit={false}
      />
    </View>
  );
}

/** One of setup's AI runs: what it is doing, or why it failed with a way to try again. */
export function SetupRun({
  id,
  label,
  onRetry,
}: {
  id: string | null;
  label: string;
  onRetry?: () => void;
}) {
  const { c } = useTheme();
  const run = useRun(id ?? '').data?.run;
  if (!id || !run) return null;
  if (run.status === 'succeeded' || run.status === 'cancelled') return null;
  const failed = run.status === 'failed' || run.status === 'interrupted';
  return (
    <View style={[styles.run, { backgroundColor: failed ? c.dangerSoft : c.primarySoft }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {failed ? (
          <MaterialIcons name="error-outline" size={18} color={c.danger} />
        ) : (
          <ActivityIndicator size="small" color={c.primaryInk} />
        )}
        <View style={{ flex: 1 }}>
          <T variant="label" style={{ color: failed ? c.danger : c.primaryInk }}>
            {failed ? `${label} didn’t work` : `${label}…`}
          </T>
          <T variant="meta" tone="lead" numberOfLines={2}>
            {failed
              ? (run.error ?? 'Something went wrong.')
              : run.status === 'queued'
                ? 'Waiting for a free slot'
                : (run.step ?? 'Starting')}
          </T>
        </View>
      </View>
      {failed && onRetry ? (
        <View style={{ flexDirection: 'row', marginTop: space.sm }}>
          <Button kind="secondary" label="Try again" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: hit.min - 8,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  run: { borderRadius: radius.base, padding: space.md, marginVertical: space.sm },
});
