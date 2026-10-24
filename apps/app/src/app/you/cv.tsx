import { RUN_COSTS } from '@winnow/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { DocEditor } from '@/components/DocEditor';
import { Button, Header, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { pickPdf } from '@/lib/files';
import { useActiveRuns } from '@/lib/hooks';
import { applyRun, keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

/** Upload a CV as a PDF; a Read CV run turns it into the Markdown below. Web only for now. */
function UploadPdf() {
  const { c } = useTheme();
  const [sending, setSending] = useState(false);
  const reading = useActiveRuns().data?.find((r) => r.kind === 'cv_import');
  if (Platform.OS !== 'web') return null;

  const upload = async () => {
    const file = await pickPdf();
    if (!file) return;
    setSending(true);
    try {
      const runs = await api.uploadCvPdf(file, file.name);
      for (const r of runs) applyRun(r);
      void queryClient.invalidateQueries({ queryKey: keys.activeRuns });
      toast.show('Reading your CV. It replaces the one below when it’s done.');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <View
      style={{
        marginTop: space.md,
        padding: space.md,
        gap: space.sm,
        borderWidth: 1,
        borderColor: c.rule,
        borderRadius: 8,
        backgroundColor: c.surface,
      }}
    >
      {reading ? (
        <>
          <T variant="label">Reading {reading.subtitle ?? 'your CV'}…</T>
          <T variant="meta" tone="lead">
            {reading.status === 'queued' ? 'Waiting for a free slot' : (reading.step ?? 'Starting')}
          </T>
          <View style={{ flexDirection: 'row' }}>
            <Button
              kind="ghost"
              label="Open run"
              onPress={() => router.push(`/run/${reading.id}` as never)}
            />
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row' }}>
            <Button
              kind="secondary"
              icon="upload-file"
              label="Upload a PDF"
              busy={sending}
              onPress={() => void upload()}
            />
          </View>
          <T variant="meta" tone="lead">
            AI turns it into Markdown, keeping every fact and adding none. Your current CV is kept
            as a backup. Uses tokens · {RUN_COSTS.cv_import.estimate}
          </T>
        </>
      )}
    </View>
  );
}

export default function Cv() {
  return (
    <Screen header={<Header title="CV" />}>
      <UploadPdf />
      <DocEditor
        field="cv"
        hint="Your CV in Markdown. Triage reads the start of it; scoring reads all of it and never claims experience it doesn’t show."
      />
    </Screen>
  );
}
