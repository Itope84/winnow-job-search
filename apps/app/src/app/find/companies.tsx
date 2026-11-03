import { useQuery } from '@tanstack/react-query';
import type { SourceEntry } from '@winnow/api';
import { useState } from 'react';
import { View } from 'react-native';
import { FindPortalSheet } from '@/components/FindPortalSheet';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Button, Field, Header, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { keys } from '@/lib/query';
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
          <SeenCompanies
            tracked={draft.companies.map((co) => co.name.toLowerCase())}
            onAdd={(entry, name) => add({ ...entry, name, enabled: true }, `Added ${name}.`)}
          />
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

/** Companies that keep turning up in this person's jobs, ready to add with one tap. */
function SeenCompanies({
  tracked,
  onAdd,
}: {
  tracked: string[];
  onAdd: (entry: SourceEntry, name: string) => void;
}) {
  const seen = useQuery({ queryKey: keys.seen, queryFn: api.seenCompanies }).data ?? [];
  const show = seen.filter((s) => !tracked.includes(s.feed.company.toLowerCase()));
  if (!show.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>Seen in your scans</SectionTitle>
      <T variant="meta" tone="lead">
        Companies whose jobs keep reaching you, or scored well. Tap to track one.
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {show.map((s) => (
          <Button
            key={s.feed.company}
            kind="secondary"
            icon="add"
            label={s.feed.company}
            hint={null}
            onPress={() => onAdd(s.feed.entry, s.feed.company)}
          />
        ))}
      </View>
    </View>
  );
}
