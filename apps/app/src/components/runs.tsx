import type { Run } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { duration, money, timeAgo } from '@/lib/format';
import { useActiveRuns } from '@/lib/hooks';
import { applyRun } from '@/lib/query';
import { toast } from '@/lib/toast';
import { fonts, radius, space, type, useTheme } from '@/theme';
import { Chip, RUN_STATUS_LABEL, runTone } from './chips';
import { Button, ProgressBar, T } from './ui';

/** Re-render every second while something is running, so durations tick. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

async function act(fn: () => Promise<Run | Run[]>, done: string) {
  try {
    const out = await fn();
    for (const r of Array.isArray(out) ? out : [out]) applyRun(r);
    toast.show(done);
  } catch (e) {
    toast.show((e as Error).message);
  }
}

/**
 * The one card every run gets, the same on Activity, in the live strip sheet and on a job: kind, progress,
 * current step, time, cost and result, with the action that matters.
 */
export function RunCard({ run, compact }: { run: Run; compact?: boolean }) {
  const { c } = useTheme();
  const live = run.status === 'running';
  useTick(live);
  const p = run.progress;
  const ratio = p && p.total ? p.done / p.total : null;
  const meta = [
    run.startedAt ? duration(run.startedAt, run.finishedAt) : null,
    run.model,
    run.costUsd != null ? money(run.costUsd) : RUN_COSTS[run.kind].paid ? null : 'Free',
  ]
    .filter(Boolean)
    .join(' · ');
  const attention = run.status === 'interrupted' || run.status === 'needs_input';
  return (
    <Pressable
      onPress={() => router.push(`/run/${run.id}` as never)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? c.tint : c.surface,
          borderLeftColor: attention ? c.amber : run.status === 'failed' ? c.danger : 'transparent',
        },
      ]}
    >
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[type.label, { color: c.ink, fontFamily: fonts.uiSemibold }]}
            numberOfLines={1}
          >
            {run.title}
          </Text>
          {run.subtitle ? (
            <Text style={[type.meta, { color: c.lead }]} numberOfLines={1}>
              {run.subtitle}
            </Text>
          ) : null}
        </View>
        {live ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Chip label={RUN_STATUS_LABEL[run.status]} tone={runTone(run)} />
        )}
      </View>
      {live || run.status === 'queued' ? (
        <View style={{ gap: 6, marginTop: space.sm }}>
          {run.step ? (
            <Text style={[type.bodySmall, { color: c.lead }]} numberOfLines={compact ? 1 : 2}>
              {run.step}
            </Text>
          ) : run.status === 'queued' ? (
            <Text style={[type.bodySmall, { color: c.lead }]}>Waiting for a free slot</Text>
          ) : null}
          {p && p.total ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.mono, { color: c.ink }]}>
                  {p.done.toLocaleString()} / {p.total.toLocaleString()} {p.unit}
                </Text>
                {ratio != null ? (
                  <Text style={[type.mono, { color: c.lead }]}>{Math.round(ratio * 100)}%</Text>
                ) : null}
              </View>
              <ProgressBar value={ratio ?? 0} height={3} />
            </View>
          ) : live ? (
            <ProgressBar value={0.05} height={3} />
          ) : null}
        </View>
      ) : null}
      {run.summary && !live ? (
        <Text
          style={[type.bodySmall, { color: c.ink, marginTop: 6 }]}
          numberOfLines={compact ? 1 : 3}
        >
          {run.summary}
        </Text>
      ) : null}
      {run.error && !live ? (
        <Text
          style={[type.bodySmall, { color: c.dangerText, marginTop: 6 }]}
          numberOfLines={compact ? 2 : 4}
        >
          {run.error}
        </Text>
      ) : null}
      <View style={[styles.foot, { marginTop: space.sm }]}>
        <Text style={[type.meta, { color: c.faint, flex: 1 }]} numberOfLines={1}>
          {meta || timeAgo(run.createdAt)}
          {run.finishedAt ? ` · ${timeAgo(run.finishedAt)}` : ''}
        </Text>
        {live || run.status === 'queued' ? (
          <Button
            kind="ghost"
            label="Cancel"
            onPress={() => void act(() => api.cancelRun(run.id), 'Cancelling')}
          />
        ) : run.status === 'interrupted' ? (
          <Button
            kind="primary"
            label="Resume"
            icon="play-arrow"
            onPress={() => void act(() => api.resumeRun(run.id), 'Resumed')}
          />
        ) : run.status === 'failed' || run.status === 'cancelled' ? (
          <Button
            kind="ghost"
            label="Retry"
            onPress={() => void act(() => api.retryRun(run.id), 'Started again')}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** A thin bar under the header while anything runs. Tapping it opens Activity. */
export function LiveStrip() {
  const { c } = useTheme();
  const runs = useActiveRuns().data ?? [];
  const running = runs.filter((r) => r.status === 'running');
  const lead = running.find((r) => r.lane === 'scan') ?? running[0] ?? runs[0];
  if (!lead) return null;
  const p = lead.progress;
  const more = runs.length - 1;
  const label = `${lead.title}${p && p.total ? ` · ${p.done.toLocaleString()}/${p.total.toLocaleString()}` : lead.status === 'queued' ? ' · waiting' : ''}`;
  return (
    <Pressable
      onPress={() => router.push('/activity' as never)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open Activity`}
      style={{ backgroundColor: c.primarySoft, borderRadius: radius.base, overflow: 'hidden' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <ActivityIndicator size={12} color={c.primaryInk} />
        <Text style={[type.mono, { color: c.primaryInk, flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>
        {more > 0 ? (
          <T variant="meta" tone="primary">
            +{more} more
          </T>
        ) : null}
      </View>
      {p && p.total ? (
        <View style={{ height: 2, backgroundColor: 'transparent' }}>
          <View
            style={{ width: `${(p.done / p.total) * 100}%`, height: 2, backgroundColor: c.primary }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md, borderLeftWidth: 3, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  foot: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
});
