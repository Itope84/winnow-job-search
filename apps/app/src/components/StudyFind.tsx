import type { Run, RunKind } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Chip } from '@/components/chips';
import { RunCard } from '@/components/runs';
import { Button, Icon, Row, Screen, SectionTitle, T } from '@/components/ui';
import { dateLabel, timeAgo } from '@/lib/format';
import {
  useActiveRuns,
  useCoverage,
  useScans,
  useSettings,
  useSources,
  useStartRun,
  useStudy,
} from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

function Scan({
  kind,
  name,
  body,
  last,
  active,
}: {
  kind: RunKind;
  name: string;
  body: string;
  last?: Run;
  active?: Run;
}) {
  const { c } = useTheme();
  const start = useStartRun();
  const cost = RUN_COSTS[kind];
  const settings = useSettings().data;
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.lg,
        padding: space.md,
        marginBottom: space.sm,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.title, { color: c.ink, flex: 1 }]}>{name}</Text>
        <Chip label={cost.paid ? 'Uses tokens' : 'Free'} tone={cost.paid ? 'amber' : 'neutral'} />
      </View>
      <T variant="bodySmall" tone="lead">
        {body}
      </T>
      {active ? (
        <RunCard run={active} compact />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <T variant="meta" tone="faint" style={{ flex: 1 }}>
            {last
              ? `Last run ${timeAgo(last.createdAt)} ago${last.summary ? ` · ${last.summary}` : last.error ? ' · failed' : ''}`
              : 'Never run'}
          </T>
          <Button
            kind={cost.paid ? 'secondary' : 'primary'}
            label="Start"
            busy={start.isPending}
            onPress={() =>
              start.mutate(
                { kind, options: { autoTriage: settings?.autoTriage ?? true } },
                {
                  onSuccess: () =>
                    toast.show(`${name} started. It keeps going if you close the app.`),
                },
              )
            }
          />
        </View>
      )}
    </View>
  );
}

/** Find, for scholarships: what's watched, what's swept, and how much ground that covers. */
export function StudyFind() {
  const { c } = useTheme();
  const sources = useSources().data;
  const study = useStudy().data;
  const coverage = useCoverage().data;
  const scans = useScans().data ?? [];
  const active = useActiveRuns().data ?? [];
  const pages = sources?.companies.filter((x) => x.enabled !== false).length ?? 0;
  const feeds = sources?.boards.filter((x) => x.enabled !== false).length ?? 0;
  const queries = sources?.queries.filter((x) => x.enabled).length ?? 0;
  const places = [...(study?.places.prefer ?? []), ...(study?.places.allow ?? [])];
  const last = (k: RunKind) =>
    scans.find((r) => r.kind === k && !['queued', 'running'].includes(r.status));
  const checkedCountries =
    coverage?.countries.filter((x) => x.checkedAt && x.stance !== 'exclude').length ?? 0;
  const wanted =
    coverage?.countries.filter((x) => x.stance === 'prefer' || x.stance === 'allow').length ?? 0;
  return (
    <Screen>
      <View style={{ paddingTop: space.md, gap: 4 }}>
        <Text style={[type.display, { color: c.ink }]}>Find</Text>
        <Text style={[type.bodySmall, { color: c.lead }]}>
          {pages} pages · {feeds} feeds · {places.length} places · {queries} searches
        </Text>
      </View>
      <SectionTitle>Scans</SectionTitle>
      <Scan
        kind="scan_portals"
        name="Watched pages and feeds"
        body={`Reads your ${pages} scheme and university pages for changes, ${feeds} news feeds, and the Erasmus Mundus catalogue. Free.`}
        last={last('scan_portals')}
        active={active.find((r) => r.kind === 'scan_portals')}
      />
      <Scan
        kind="scan_ai"
        name="AI search"
        body={`Sweeps each place you’d study (${places.join(', ') || 'none set'}) for programmes, university awards and grants, plus your ${queries} searches.`}
        last={last('scan_ai')}
        active={active.find((r) => r.kind === 'scan_ai')}
      />
      <SectionTitle>Coverage</SectionTitle>
      <Row
        title="What Winnow has looked at"
        subtitle={
          coverage
            ? `${checkedCountries} of ${wanted} places swept · ${coverage.rows.length} sources checked${coverage.catalogue ? ` · ${coverage.catalogue} known page${coverage.catalogue === 1 ? '' : 's'} not added` : ''}`
            : 'Countries, schemes, universities and feeds'
        }
        leading={<Icon name="travel-explore" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/coverage' as never)}
      />
      <SectionTitle>Sources</SectionTitle>
      <Row
        title="Pages and feeds"
        subtitle={`${pages} pages · ${feeds} feeds · add from Winnow’s catalogue`}
        leading={<Icon name="bookmarks" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/pages' as never)}
      />
      <Row
        title="AI searches"
        subtitle={`${queries} on`}
        leading={<Icon name="manage-search" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/queries' as never)}
      />
      <Row
        title="Where and what"
        subtitle={
          study
            ? `${study.places.prefer.length} preferred · ${study.places.allow.length} allowed · ${study.places.exclude.length} excluded`
            : ''
        }
        leading={<Icon name="public" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/study' as never)}
      />
      <SectionTitle>History</SectionTitle>
      {scans.length ? (
        scans.slice(0, 12).map((r) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/run/${r.id}` as never)}
            style={({ pressed }) => ({
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: c.rule,
              backgroundColor: pressed ? c.surface : 'transparent',
            })}
          >
            <Text style={[type.label, { color: c.ink }]}>
              {r.title} <Text style={{ color: c.faint }}>· {dateLabel(r.createdAt)}</Text>
            </Text>
            <Text style={[type.mono, { color: r.status === 'failed' ? c.dangerText : c.lead }]}>
              {r.status === 'succeeded' ? (r.summary ?? 'Done') : (r.error ?? r.status)}
            </Text>
          </Pressable>
        ))
      ) : (
        <T variant="bodySmall" tone="lead">
          No scans yet.
        </T>
      )}
    </Screen>
  );
}
