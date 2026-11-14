import type { Me, SetupState, SetupStep } from '@winnow/api';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AboutStep,
  CvStep,
  KnowStep,
  ReviewStep,
  SourcesStep,
  StartStep,
  WantStep,
} from '@/components/SetupSteps';
import { StepBar } from '@/components/setup';
import { Button, IconButton, Loading, Notice, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe, useSetup } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { keys, queryClient, refreshJobs } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

const ORDER: SetupStep[] = ['start', 'cv', 'about', 'want', 'know', 'review', 'sources'];

/** A new account's walkthrough: CV, details, wants, questions, a drafted profile, and sources. */
export default function Setup() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const query = useSetup();
  const s = query.data;
  const setSetupLater = usePrefs((p) => p.setSetupLater);
  const [step, setStep] = useState<SetupStep | null>(null);

  // Resume where they left off, on any device.
  useEffect(() => {
    if (s && step === null) setStep(s.status === 'done' ? 'start' : s.step);
  }, [s, step]);

  const set = useCallback((next: SetupState) => {
    queryClient.setQueryData(keys.setup, next);
    const shown = next.redo ? 'done' : next.status;
    queryClient.setQueryData<Me>(keys.me, (m) => (m ? { ...m, setup: shown } : m));
  }, []);

  const go = useCallback(
    async (next: SetupStep, patch: Record<string, unknown> = {}) => {
      try {
        set(await api.saveSetup({ step: next, ...patch }));
        setStep(next);
      } catch (e) {
        toast.show((e as Error).message);
      }
    },
    [set],
  );

  const later = () => {
    if (me) setSetupLater(me.id);
    router.replace('/');
  };

  const finished = (scan: boolean, runs: number) => {
    setSetupLater(null);
    void queryClient.invalidateQueries({ queryKey: keys.sources });
    void queryClient.invalidateQueries({ queryKey: keys.profile });
    refreshJobs();
    toast.show(
      scan && runs
        ? `You’re set up. Your first scan is running; new ${s?.mode === 'scholarships' ? 'items' : 'jobs'} land in Inbox.`
        : 'You’re set up.',
    );
    router.replace('/');
  };

  const redo = async () => {
    try {
      set(await api.startSetup(true));
      setStep('start');
    } catch (e) {
      toast.show((e as Error).message);
    }
  };

  const at = step ? ORDER.indexOf(step) : 0;
  const props = s ? { s, go, set } : null;
  const done = s?.status === 'done';

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top }}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 56,
            paddingHorizontal: space.xs,
          }}
        >
          {at > 1 && !done ? (
            <IconButton
              name="arrow-back"
              label="Back"
              onPress={() => setStep(ORDER[at - 1] ?? 'start')}
            />
          ) : (
            <View style={{ width: space.sm }} />
          )}
          <View style={{ flex: 1, paddingHorizontal: space.xs }}>
            <T variant="label">{s?.redo ? 'Set up again' : 'Set up Winnow'}</T>
            {at > 0 && !done ? (
              <T variant="meta" tone="lead">
                Step {at} of {ORDER.length - 1}
              </T>
            ) : null}
          </View>
          {!done && at > 0 ? <Button kind="ghost" label="Finish later" onPress={later} /> : null}
        </View>
        {at > 0 && !done ? <StepBar at={at} of={ORDER.length - 1} /> : null}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
          paddingHorizontal: space.md,
          paddingBottom: insets.bottom + space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!props || !step ? (
          query.error ? (
            <Notice tone="danger" title={(query.error as Error).message} />
          ) : (
            <Loading label="Opening setup" />
          )
        ) : done ? (
          <View style={{ marginTop: space.xl, gap: space.md }}>
            <T variant="headline">You’re set up</T>
            <T variant="body" tone="lead">
              Change your CV, profile and sources any time in You and Find. Set up again to go
              through these steps with AI once more; nothing changes until you confirm the new
              profile.
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label={s?.mode === 'scholarships' ? 'Go to Inbox' : 'Go to Jobs'}
                onPress={() => router.replace('/')}
              />
              <Button kind="secondary" label="Set up again" onPress={() => void redo()} />
            </View>
          </View>
        ) : step === 'start' ? (
          <StartStep {...props} onLater={later} />
        ) : step === 'cv' ? (
          <CvStep {...props} />
        ) : step === 'about' ? (
          <AboutStep {...props} />
        ) : step === 'want' ? (
          <WantStep {...props} />
        ) : step === 'know' ? (
          <KnowStep {...props} />
        ) : step === 'review' ? (
          <ReviewStep {...props} />
        ) : (
          <SourcesStep {...props} onFinished={finished} />
        )}
      </ScrollView>
    </View>
  );
}
