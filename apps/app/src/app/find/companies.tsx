import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Button, Field, Header, Notice, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { space } from '@/theme';

/** The companies Portals scans. Add one by pasting its careers page. */
export default function Companies() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; provider?: string; message?: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const res = await api.checkSource({ name, careers_url: url.trim() });
      setCheck(res);
      update((s) => ({
        ...s,
        companies: [
          ...s.companies,
          { name: name.trim() || url.trim(), careers_url: url.trim(), enabled: true },
        ],
      }));
      setName('');
      setUrl('');
    } catch (e) {
      setCheck({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Companies" />}
      footer={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />}
    >
      {loading || !draft ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            Portals checks each company’s jobs page directly. Companies no scanner can read are
            covered by AI search instead.
          </T>
          <SectionTitle>Add a company</SectionTitle>
          <Field label="Careers page">
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="https://job-boards.greenhouse.io/…"
              autoCapitalize="none"
              keyboardType="url"
            />
          </Field>
          <Field label="Name">
            <Input value={name} onChangeText={setName} placeholder="Company name" />
          </Field>
          <Button
            kind="secondary"
            label="Add"
            busy={busy}
            disabled={!/^https?:\/\//.test(url.trim())}
            onPress={() => void add()}
          />
          {check ? (
            <Notice
              tone={check.ok ? 'info' : 'warning'}
              title={
                check.ok
                  ? `Read by the ${check.provider} scanner`
                  : 'No scanner reads this page yet'
              }
              body={
                check.ok ? 'Save to include it in the next Portals scan.' : (check.message ?? null)
              }
            />
          ) : null}
          <SectionTitle>{`Tracked · ${draft.companies.length}`}</SectionTitle>
          {draft.companies.map((co, i) => (
            <ToggleRow
              key={`${co.name}-${i}`}
              title={co.name}
              subtitle={String(co.careers_url ?? co.api ?? co.provider ?? '')}
              value={co.enabled !== false}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  companies: s.companies.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                }))
              }
              onRemove={() =>
                update((s) => ({ ...s, companies: s.companies.filter((_, j) => j !== i) }))
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
