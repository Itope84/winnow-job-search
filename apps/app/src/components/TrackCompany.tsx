import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';
import { SYSTEMS } from './FindPortalSheet';
import { Icon, T } from './ui';

/** On a job's page: its company posts on a job system Winnow reads, and the person doesn't track it. */
export function TrackCompany({ jobId }: { jobId: string }) {
  const { c } = useTheme();
  const q = useQuery({ queryKey: keys.jobFeed(jobId), queryFn: () => api.jobFeed(jobId) });
  const [busy, setBusy] = useState(false);
  const feed = q.data?.feed;
  if (!feed) return null;
  const done = () => {
    queryClient.setQueryData(keys.jobFeed(jobId), { feed: null });
    void queryClient.invalidateQueries({ queryKey: keys.seen });
  };
  const track = async () => {
    setBusy(true);
    try {
      const sources = await api.sources();
      const saved = await api.saveSources({
        ...sources,
        companies: [...sources.companies, { ...feed.entry, name: feed.company, enabled: true }],
      });
      queryClient.setQueryData(keys.sources, saved);
      toast.show(`Tracking ${feed.company}: Portals scans its jobs from now on.`);
      done();
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    await api.dismissSeen(feed.company).catch(() => {});
    done();
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.base,
        backgroundColor: c.surface,
      }}
    >
      <Icon name="travel-explore" size={18} tone="lead" />
      <T variant="bodySmall" tone="lead" style={{ flex: 1 }}>
        {`${feed.company} posts its jobs on ${SYSTEMS[feed.provider] ?? feed.provider}.`}
      </T>
      <Pressable
        onPress={() => void track()}
        disabled={busy}
        accessibilityRole="button"
        hitSlop={8}
      >
        <T variant="label" tone="primary">
          {busy ? 'Adding…' : 'Track it'}
        </T>
      </Pressable>
      <Pressable
        onPress={() => void dismiss()}
        accessibilityRole="button"
        accessibilityLabel="Not a company to track"
        hitSlop={8}
      >
        <Icon name="close" size={18} tone="faint" />
      </Pressable>
    </View>
  );
}
