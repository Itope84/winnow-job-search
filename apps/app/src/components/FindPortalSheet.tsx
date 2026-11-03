import type { PortalMatch, SourceEntry } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/lib/api';
import { useRun } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { space, useTheme } from '@/theme';
import { Sheet } from './Sheet';
import { Button, Notice, T } from './ui';

export const SYSTEMS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  personio: 'Personio',
  teamtailor: 'Teamtailor',
  recruitee: 'Recruitee',
  bamboohr: 'BambooHR',
  avature: 'Avature',
  apple: 'Apple Jobs',
  google: 'Google Careers',
};
const HOW: Record<PortalMatch['how'], string> = {
  direct: 'Read as pasted',
  directory: 'Found by the company’s name',
  page: 'The page loads its jobs from here',
  ai: 'AI found this behind the page',
};

type Step =
  | { kind: 'looking' }
  | { kind: 'found'; matches: PortalMatch[] }
  | { kind: 'none' }
  | { kind: 'ai'; runId: string }
  | { kind: 'ai-none'; reason: string };

/**
 * Adding a company: find the job feed behind the careers page and ask "Is this it?". When nothing
 * reads the page, AI can look; when AI can't either, the page can go to AI search, or not be added.
 */
export function FindPortalSheet({
  url,
  name,
  onClose,
  onAdd,
}: {
  /** The pasted link; the sheet is open while it is set. */
  url: string | null;
  name: string;
  onClose: () => void;
  onAdd: (entry: SourceEntry, note: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'looking' });
  useEffect(() => {
    if (!url) return;
    let live = true;
    setStep({ kind: 'looking' });
    api
      .findSource({ name, careers_url: url })
      .then((r) => {
        if (live)
          setStep(r.matches.length ? { kind: 'found', matches: r.matches } : { kind: 'none' });
      })
      .catch((e) => {
        if (live) {
          toast.show((e as Error).message);
          setStep({ kind: 'none' });
        }
      });
    return () => {
      live = false;
    };
  }, [url, name]);

  const askAi = async () => {
    if (!url) return;
    try {
      const [run] = await api.startRun({
        kind: 'find_portal',
        url,
        name: name.trim() || undefined,
      });
      if (run) setStep({ kind: 'ai', runId: run.id });
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  const forAiSearch = () => {
    if (!url) return;
    onAdd({ name: name.trim() || url, careers_url: url, enabled: true }, 'Added for AI search.');
  };

  return (
    <Sheet open={!!url} onClose={onClose} title="Add a company">
      {step.kind === 'looking' ? (
        <Waiting text="Looking for the job feed behind this page…" />
      ) : step.kind === 'found' ? (
        <Matches matches={step.matches} onAdd={onAdd} onNone={() => setStep({ kind: 'none' })} />
      ) : step.kind === 'ai' ? (
        <AiStep
          runId={step.runId}
          onDone={(matches, reason) =>
            setStep(matches.length ? { kind: 'found', matches } : { kind: 'ai-none', reason })
          }
        />
      ) : (
        <View style={{ gap: space.md }}>
          <Notice
            tone="warning"
            icon="search-off"
            title="No scanner reads this page"
            body={
              step.kind === 'ai-none'
                ? `AI couldn’t find the feed either. ${step.reason}`
                : 'It isn’t a job system Winnow knows, and the page doesn’t load jobs from one.'
            }
          />
          {step.kind === 'none' ? (
            <View style={{ gap: 4 }}>
              <Button label="Ask AI to look" icon="auto-awesome" onPress={() => void askAi()} />
              <T variant="meta" tone="faint">
                Uses tokens · {RUN_COSTS.find_portal.estimate}
              </T>
            </View>
          ) : null}
          <View style={{ gap: 4 }}>
            <Button kind="secondary" label="Add it to AI search" onPress={forAiSearch} />
            <T variant="meta" tone="faint">
              AI search opens the page on every run: slower, uses tokens, and misses jobs on long
              lists.
            </T>
          </View>
          <Button kind="ghost" label="Don’t add it" onPress={onClose} />
        </View>
      )}
    </Sheet>
  );
}

function Waiting({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'center',
        paddingVertical: space.md,
      }}
    >
      <ActivityIndicator color={c.lead} />
      <T tone="lead">{text}</T>
    </View>
  );
}

function Matches({
  matches,
  onAdd,
  onNone,
}: {
  matches: PortalMatch[];
  onAdd: (entry: SourceEntry, note: string) => void;
  onNone: () => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      <T variant="bodySmall" tone="lead">
        {matches.length === 1 ? 'Is this it?' : 'Is it one of these?'}
      </T>
      {matches.map((m) => {
        const system = SYSTEMS[m.provider] ?? m.provider;
        const link = String(m.entry.api ?? m.entry.careers_url ?? '');
        return (
          <View key={link} style={{ gap: 4 }}>
            <T variant="title">{system}</T>
            <T variant="bodySmall">
              {m.sample.length ? `Jobs like ${m.sample.join(' · ')}` : 'No open jobs right now'}
            </T>
            <T variant="meta" tone="lead">
              {HOW[m.how]}
            </T>
            <T variant="meta" tone="faint">
              {link}
            </T>
            <Button
              label="Use this"
              icon="check"
              onPress={() => onAdd(m.entry, `Added: read by the ${system} scanner.`)}
            />
          </View>
        );
      })}
      <Button kind="ghost" label="None of these" onPress={onNone} />
    </View>
  );
}

function AiStep({
  runId,
  onDone,
}: {
  runId: string;
  onDone: (matches: PortalMatch[], reason: string) => void;
}) {
  const run = useRun(runId).data?.run;
  useEffect(() => {
    if (!run) return;
    if (run.status === 'succeeded') {
      const r = (run.result ?? {}) as { matches?: PortalMatch[]; reason?: string };
      onDone(r.matches ?? [], r.reason ?? '');
    } else if (['failed', 'cancelled', 'interrupted'].includes(run.status))
      onDone([], run.error ?? 'The run stopped.');
  }, [run, onDone]);
  return <Waiting text="AI is looking at the page…" />;
}
