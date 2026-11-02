import type { JobList } from '@winnow/api';
import { LIST_LABELS, LISTS } from '@winnow/api';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useCounts } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';
import { Check } from './inputs';
import { Sheet } from './Sheet';
import { Button, T } from './ui';

const NOTES: Partial<Record<JobList, string>> = {
  scored: 'Their scores, reports, CVs and letters go too',
  applied: 'Their stages, notes, CVs and letters go too',
  archive: 'Archived jobs still posted can come back',
};

/** Clear whole lists, so the next scans find whatever is still posted as new. */
export function ResetJobsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const counts = useCounts().data;
  const [picked, setPicked] = useState<JobList[]>([]);
  const [busy, setBusy] = useState(false);
  const total = picked.reduce((n, l) => n + (counts?.[l] ?? 0), 0);
  const toggle = (l: JobList) =>
    setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const close = () => {
    setPicked([]);
    onClose();
  };
  const reset = async () => {
    setBusy(true);
    try {
      const { removed } = await api.resetJobs(picked);
      void queryClient.invalidateQueries({ queryKey: keys.counts });
      void queryClient.invalidateQueries({ queryKey: keys.jobs });
      toast.show(`${removed.toLocaleString()} ${removed === 1 ? 'job' : 'jobs'} cleared`);
      close();
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Reset jobs"
      footer={
        <Button
          kind="danger"
          label={
            total ? `Clear ${total.toLocaleString()} ${total === 1 ? 'job' : 'jobs'}` : 'Clear'
          }
          icon="delete-sweep"
          busy={busy}
          disabled={!picked.length || busy}
          onPress={() => void reset()}
        />
      }
    >
      <View style={{ gap: space.sm }}>
        <T variant="bodySmall" tone="lead">
          Cleared jobs are deleted and forgotten, so a later scan adds any that are still posted as
          new. Lists you leave alone stay as they are, and their jobs won't come back as new.
        </T>
        <View>
          {LISTS.map((l) => (
            <Check
              key={l}
              checked={picked.includes(l)}
              label={`${LIST_LABELS[l]} · ${(counts?.[l] ?? 0).toLocaleString()}`}
              note={NOTES[l]}
              onToggle={() => toggle(l)}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}
