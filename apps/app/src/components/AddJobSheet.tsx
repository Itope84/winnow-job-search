import type { AddJobRequest } from '@winnow/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { refreshJobs } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';
import { Input } from './inputs';
import { Sheet } from './Sheet';
import { Button, Field, Notice, T } from './ui';

/** Add a job no scan found: paste a link, or paste the text. */
export function AddJobSheet({
  open,
  onClose,
  onAdded,
  initialUrl,
}: {
  open: boolean;
  onClose: () => void;
  onAdded?: (id: string) => void;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [mode, setMode] = useState<'link' | 'text'>('link');
  const [busy, setBusy] = useState<AddJobRequest['then'] | null>(null);
  const [needsText, setNeedsText] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? '');
      setText('');
      setCompany('');
      setRole('');
      setMode('link');
      setNeedsText(false);
      setError(null);
    }
  }, [open, initialUrl]);

  const submit = async (then: AddJobRequest['then']) => {
    setBusy(then);
    setError(null);
    try {
      const res = await api.addJob({
        url: url.trim() || undefined,
        text: mode === 'text' || needsText ? text.trim() || undefined : undefined,
        company: company.trim() || undefined,
        role: role.trim() || undefined,
        then,
      });
      if (res.needsText) {
        setNeedsText(true);
        setMode('text');
        setError(
          'That page can’t be read from here (it may need a login). Paste the job description below.',
        );
        return;
      }
      refreshJobs();
      if (!res.job) return;
      toast.show(
        res.duplicate
          ? 'Already in Winnow: opening it'
          : then === 'score'
            ? 'Added · scoring started'
            : then === 'shortlist'
              ? 'Added to Shortlist'
              : 'Added to Inbox',
      );
      onClose();
      if (onAdded) onAdded(res.job.id);
      else router.push(`/job/${res.job.id}` as never);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ready = mode === 'link' ? /^https?:\/\/\S+$/.test(url.trim()) : text.trim().length > 40;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a job"
      footer={
        <View style={{ gap: space.sm }}>
          <Button
            label="Add to Inbox"
            icon="add"
            busy={busy === 'inbox'}
            disabled={!ready || !!busy}
            onPress={() => void submit('inbox')}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              style={{ flex: 1 }}
              kind="secondary"
              label="Add to Shortlist"
              busy={busy === 'shortlist'}
              disabled={!ready || !!busy}
              onPress={() => void submit('shortlist')}
            />
            <Button
              style={{ flex: 1 }}
              kind="secondary"
              label="Add and score"
              busy={busy === 'score'}
              disabled={!ready || !!busy}
              onPress={() => void submit('score')}
            />
          </View>
          <T variant="meta" tone="faint" style={{ textAlign: 'center' }}>
            Added jobs skip triage. Scoring uses tokens.
          </T>
        </View>
      }
    >
      {error ? <Notice tone="warning" title={error} /> : null}
      {mode === 'link' ? (
        <Field label="Link to the posting">
          <Input
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
          />
        </Field>
      ) : (
        <>
          <Field label="Job description">
            <Input
              area
              multiline
              value={text}
              onChangeText={setText}
              placeholder="Paste the whole posting"
              style={{ minHeight: 160 }}
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="Company">
                <Input value={company} onChangeText={setCompany} placeholder="Optional" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Role">
                <Input value={role} onChangeText={setRole} placeholder="Optional" />
              </Field>
            </View>
          </View>
          {!needsText ? (
            <Field label="Link (optional)">
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://…"
                autoCapitalize="none"
              />
            </Field>
          ) : null}
        </>
      )}
      <Button
        kind="ghost"
        label={mode === 'link' ? 'No link? Paste the text instead' : 'Use a link instead'}
        onPress={() => setMode(mode === 'link' ? 'text' : 'link')}
      />
    </Sheet>
  );
}
