import type { Run, RunKind } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import { router } from 'expo-router';
import { Pressable, Switch, Text, View } from 'react-native';
import { Chip } from '@/components/chips';
import { RunCard } from '@/components/runs';
import { StudyFind } from '@/components/StudyFind';
import { Button, Divider, Icon, Row, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { dateLabel, timeAgo } from '@/lib/format';
import {
  useActiveRuns,
  useJack,
  useScans,
  useSettings,
  useSources,
  useStartRun,
} from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { useMode } from '@/lib/study';
import { toast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

const SCANS: {
  kind: RunKind;
  name: string;
  body: (n: { companies: number; boards: number; queries: number }) => string;
}[] = [
  {
    kind: 'scan_portals',
    name: 'Portals',
    body: (n) => `Your ${n.companies} companies and ${n.boards} job boards.`,
  },
  {
    kind: 'scan_ats',
    name: 'Full ATS',
    body: () =>
      'Every company on Greenhouse, Lever, Ashby and Workday, filtered by your rules. Recent postings only.',
  },
  {
    kind: 'scan_ai',
    name: 'AI search',
    body: (n) => `Your ${n.queries} search queries, plus career sites no scanner covers.`,
  },
  {
    kind: 'scan_jack',
    name: 'Jack',
    body: () => 'Jill roles on your radar, and Jack’s search on your Jack brief.',
  },
];

function ScanCard({
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
        <Chip label={cost.estimate} />
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
                    toast.show(`${name} scan started. It keeps going if you close the app.`),
                },
              )
            }
          />
        </View>
      )}
    </View>
  );
}

export default function Find() {
  return useMode() === 'scholarships' ? <StudyFind /> : <JobsFind />;
}

function JobsFind() {
  const { c } = useTheme();
  const sources = useSources().data;
  const settings = useSettings().data;
  const scans = useScans().data ?? [];
  const active = useActiveRuns().data ?? [];
  const jack = useJack().data;
  const n = {
    companies: sources?.companies.filter((x) => x.enabled !== false).length ?? 0,
    boards: sources?.boards.filter((x) => x.enabled !== false).length ?? 0,
    queries: sources?.queries.filter((x) => x.enabled).length ?? 0,
  };
  const rules = sources?.rules;
  const setAuto = async (v: boolean) => {
    queryClient.setQueryData(keys.settings, { ...settings, autoTriage: v });
    await api.saveSettings({ autoTriage: v }).catch((e) => toast.show((e as Error).message));
    void queryClient.invalidateQueries({ queryKey: keys.settings });
  };
  return (
    <Screen>
      <View style={{ paddingTop: space.md, gap: 4 }}>
        <Text style={[type.display, { color: c.ink }]}>Find</Text>
        <Text style={[type.bodySmall, { color: c.lead }]}>
          {n.companies} companies · {n.boards} boards · {n.queries} AI queries
        </Text>
      </View>
      <SectionTitle>Scans</SectionTitle>
      {SCANS.filter((s) => s.kind !== 'scan_jack' || jack?.connected).map((s) => (
        <ScanCard
          key={s.kind}
          kind={s.kind}
          name={s.name}
          body={s.body(n)}
          last={scans.find((r) => r.kind === s.kind && !['queued', 'running'].includes(r.status))}
          active={active.find((r) => r.kind === s.kind)}
        />
      ))}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingVertical: space.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <T variant="label">Triage new jobs after each scan</T>
          <T variant="meta" tone="lead">
            Keeps, discards or flags each new job with a reason. Uses tokens.
          </T>
        </View>
        <Switch
          value={settings?.autoTriage ?? true}
          onValueChange={(v) => void setAuto(v)}
          trackColor={{ true: c.primary, false: c.ruleStrong }}
        />
      </View>
      <Divider />
      <SectionTitle>Sources</SectionTitle>
      <Row
        title="Companies"
        subtitle={`${n.companies} tracked`}
        leading={<Icon name="apartment" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/companies' as never)}
      />
      <Row
        title="Job boards"
        subtitle={`${n.boards} on`}
        leading={<Icon name="hub" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/boards' as never)}
      />
      <Row
        title="AI search queries"
        subtitle={`${n.queries} on`}
        leading={<Icon name="manage-search" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/queries' as never)}
      />
      <Row
        title="Rules"
        subtitle={
          rules
            ? `${rules.title.positive.length} role words · ${rules.title.negative.length} excluded · ${rules.location.allow.length + rules.location.alwaysAllow.length} places${rules.salary.min ? ` · ${rules.salary.currency} ${Math.round(rules.salary.min / 1000)}k floor` : ''}`
            : ''
        }
        leading={<Icon name="rule" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/find/rules' as never)}
      />
      <SectionTitle>History</SectionTitle>
      {scans.length ? (
        scans.slice(0, 12).map((r) => {
          const res = (r.result ?? {}) as {
            found?: number;
            added?: number;
            duplicates?: number;
            filteredTitle?: number;
            filteredRules?: number;
          };
          return (
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
                {r.status === 'succeeded'
                  ? `${res.found ?? 0} found · ${res.added ?? 0} new · ${res.duplicates ?? 0} duplicates · ${(res.filteredTitle ?? 0) + (res.filteredRules ?? 0)} filtered`
                  : (r.error ?? r.status)}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <T variant="bodySmall" tone="lead">
          No scans yet in Winnow. Imported jobs came from career-ops.
        </T>
      )}
    </Screen>
  );
}
