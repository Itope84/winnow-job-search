import { RUN_LABELS } from '@winnow/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { CompanyTile } from '@/components/JobRow';
import { RunCard } from '@/components/runs';
import { Button, Empty, Header, Loading, Row, Screen, SectionTitle, T } from '@/components/ui';
import { companyLabel, dateLabel } from '@/lib/format';
import { useJob, useRun } from '@/lib/hooks';
import { space, type, useTheme } from '@/theme';

function JobLink({ id }: { id: string }) {
  const job = useJob(id);
  if (!job.data) return null;
  return (
    <Row
      title={job.data.role}
      subtitle={`${companyLabel(job.data.company)} · ${job.data.location}`}
      leading={<CompanyTile company={job.data.company} size={32} />}
      onPress={() => router.push(`/job/${id}` as never)}
    />
  );
}

export default function RunPage() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useRun(id ?? '');
  const [showAll, setShowAll] = useState(false);
  const data = q.data;
  const kindColor = {
    step: c.ink,
    tool: c.lead,
    text: c.ink,
    stderr: c.dangerText,
    info: c.primaryInk,
  } as const;
  const log = data?.log ?? [];
  const shown = showAll ? log : log.slice(-200);
  return (
    <Screen header={<Header title={data ? RUN_LABELS[data.run.kind] : 'Run'} />}>
      {q.isLoading ? (
        <Loading />
      ) : !data ? (
        <Empty
          icon="error-outline"
          title="Couldn’t load this run"
          body={(q.error as Error | null)?.message}
        />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <RunCard run={data.run} />
          {data.run.jobIds.length && data.run.jobIds.length <= 3 ? (
            <>
              <SectionTitle>Job</SectionTitle>
              {data.run.jobIds.map((jid) => (
                <JobLink key={jid} id={jid} />
              ))}
            </>
          ) : null}
          <SectionTitle>{`Log · ${log.length} lines`}</SectionTitle>
          {!log.length ? (
            <T variant="bodySmall" tone="lead">
              Nothing logged yet.
            </T>
          ) : (
            <View
              style={{ backgroundColor: c.surface, borderRadius: 8, padding: space.sm, gap: 2 }}
            >
              {log.length > shown.length ? (
                <Button
                  kind="ghost"
                  label={`Show all ${log.length}`}
                  onPress={() => setShowAll(true)}
                />
              ) : null}
              {shown.map((l) => (
                <Text
                  key={l.seq}
                  selectable
                  style={[type.mono, { color: kindColor[l.kind], fontSize: 12, lineHeight: 17 }]}
                >
                  <Text style={{ color: c.faint }}>{dateLabel(l.at).split(', ').pop()} </Text>
                  {l.text}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}
