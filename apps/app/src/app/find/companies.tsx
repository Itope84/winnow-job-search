import type { SourceEntry } from '@winnow/api';
import { useState } from 'react';
import { View } from 'react-native';
import { FindPortalSheet } from '@/components/FindPortalSheet';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Button, Field, Header, Screen, SectionTitle, T } from '@/components/ui';
import { toast } from '@/lib/toast';
import { space } from '@/theme';

/** The companies Portals scans. Add one by pasting its careers page. */
export default function Companies() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [finding, setFinding] = useState<string | null>(null);

  const add = (entry: SourceEntry, note: string) => {
    update((s) => ({ ...s, companies: [...s.companies, entry] }));
    toast.show(`${note} Save to keep it.`);
    setFinding(null);
    setName('');
    setUrl('');
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
            Portals reads each company’s jobs from its job system. Paste any careers page: Winnow
            finds the feed behind it.
          </T>
          <SectionTitle>Add a company</SectionTitle>
          <T variant="meta" tone="lead">
            Tip: for a large company, search its jobs site first (your country, city or team) and
            paste that link. Add several for one company if you like: Apple UK and Apple Singapore,
            say.
          </T>
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
            disabled={!/^https?:\/\//.test(url.trim())}
            onPress={() => setFinding(url.trim())}
          />
          <FindPortalSheet url={finding} name={name} onClose={() => setFinding(null)} onAdd={add} />
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
