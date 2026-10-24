import type { Run } from '@winnow/api';
import { Text, View } from 'react-native';
import { RunCard } from '@/components/runs';
import { Empty, Loading, Screen, SectionTitle } from '@/components/ui';
import { useActiveRuns, useRuns } from '@/lib/hooks';
import { space, type, useTheme } from '@/theme';

/** Every run, live and past. The server keeps them, so this is the same on every device. */
export default function Activity() {
  const { c } = useTheme();
  const active = useActiveRuns();
  const all = useRuns();
  const live = active.data ?? [];
  const past = (all.data ?? []).filter(
    (r) => !['queued', 'running', 'needs_input'].includes(r.status),
  );
  const groups: [string, Run[], 'amber' | undefined][] = [
    ['Running', live.filter((r) => r.status === 'running'), undefined],
    [
      'Needs you',
      [
        ...live.filter((r) => r.status === 'needs_input'),
        ...past.filter((r) => r.status === 'interrupted'),
      ],
      'amber',
    ],
    ['Waiting', live.filter((r) => r.status === 'queued'), undefined],
    ['Done', past.filter((r) => r.status === 'succeeded').slice(0, 40), undefined],
    [
      'Failed and cancelled',
      past.filter((r) => r.status === 'failed' || r.status === 'cancelled').slice(0, 20),
      undefined,
    ],
  ];
  return (
    <Screen>
      <View style={{ paddingTop: space.md, gap: 4 }}>
        <Text style={[type.display, { color: c.ink }]}>Activity</Text>
        <Text style={[type.bodySmall, { color: c.lead }]}>
          Scans, triage and scoring. They keep running when you close the app.
        </Text>
      </View>
      {active.isLoading || all.isLoading ? (
        <Loading />
      ) : !live.length && !past.length ? (
        <Empty
          icon="timeline"
          title="Nothing has run yet"
          body="Start a scan from Find, or triage your inbox from Jobs."
        />
      ) : (
        groups.map(([title, runs]) =>
          runs.length ? (
            <View key={title}>
              <SectionTitle>{`${title} · ${runs.length}`}</SectionTitle>
              {runs.map((r) => (
                <RunCard key={r.id} run={r} compact={title === 'Done'} />
              ))}
            </View>
          ) : null,
        )
      )}
    </Screen>
  );
}
