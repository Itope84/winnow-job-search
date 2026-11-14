import type { CatalogueItem } from '@winnow/api';
import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Button, Field, Header, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useCatalogue } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';

const KIND = {
  scheme: 'Scheme',
  university: 'University',
  feed: 'Feed',
  erasmus: 'Catalogue',
} as const;

/** Scheme and university pages Winnow watches for changes, and scholarship news feeds. */
export default function Pages() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  const cat = useCatalogue().data ?? [];
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const add = async (body: { urls?: string[]; fitting?: boolean }, key: string) => {
    setAdding(key);
    try {
      const saved = await api.addCatalogue(body);
      queryClient.setQueryData(keys.sources, saved);
      void queryClient.invalidateQueries({ queryKey: keys.catalogue });
      void queryClient.invalidateQueries({ queryKey: keys.coverage });
      toast.show('Added');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setAdding(null);
    }
  };
  const left = cat.filter((e) => !e.added);
  const fitting = left.filter((e) => e.fits);
  const other = left.filter((e) => !e.fits);
  const row = (e: CatalogueItem) => (
    <ToggleRow
      key={e.url}
      title={e.name}
      subtitle={[KIND[e.kind], e.countries.join(', ') || 'Anywhere', e.who, e.note]
        .filter(Boolean)
        .join(' · ')}
      value={false}
      onChange={(v) => v && void add({ urls: [e.url] }, e.url)}
    />
  );
  return (
    <Screen
      header={<Header title="Pages and feeds" />}
      footer={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />}
    >
      {loading || !draft ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            Winnow reads each page on every scan and tells you when it changes, which is how a new
            round shows up. Feeds bring scholarship news; only items about funded study get through.
          </T>
          <SectionTitle>{`Watched pages · ${draft.companies.length}`}</SectionTitle>
          {draft.companies.map((p, i) => (
            <ToggleRow
              key={`${p.name}-${i}`}
              title={p.name}
              subtitle={[
                p.provider === 'erasmus-mundus'
                  ? 'Erasmus Mundus catalogue'
                  : String(p.kind ?? 'page'),
                Array.isArray(p.countries) ? p.countries.join(', ') : null,
                String(p.careers_url ?? ''),
              ]
                .filter(Boolean)
                .join(' · ')}
              value={p.enabled !== false}
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
          <SectionTitle>{`Feeds · ${draft.boards.length}`}</SectionTitle>
          {draft.boards.map((b, i) => (
            <ToggleRow
              key={`${b.name}-${i}`}
              title={b.name}
              subtitle={String(b.api ?? b.provider)}
              value={b.enabled !== false}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  boards: s.boards.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                }))
              }
              onRemove={() => update((s) => ({ ...s, boards: s.boards.filter((_, j) => j !== i) }))}
            />
          ))}
          <SectionTitle>Watch a page</SectionTitle>
          <Field label="Name">
            <Input
              value={name}
              onChangeText={setName}
              placeholder="ETH Zurich Excellence Scholarship"
            />
          </Field>
          <Field label="Link">
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              autoCapitalize="none"
            />
          </Field>
          <Button
            kind="secondary"
            label="Add"
            disabled={!/^https?:\/\//.test(url.trim())}
            onPress={() => {
              update((s) => ({
                ...s,
                companies: [
                  ...s.companies,
                  {
                    name: name.trim() || url.trim(),
                    provider: 'page',
                    careers_url: url.trim(),
                    enabled: true,
                  },
                ],
              }));
              setName('');
              setUrl('');
            }}
          />
          {fitting.length ? (
            <>
              <SectionTitle
                right={
                  <Button
                    kind="ghost"
                    label={`Add all ${fitting.length}`}
                    busy={adding === 'all'}
                    onPress={() => void add({ fitting: true }, 'all')}
                  />
                }
              >
                Suggested for you
              </SectionTitle>
              {fitting.map(row)}
            </>
          ) : null}
          {other.length ? (
            <>
              <SectionTitle>Other known pages</SectionTitle>
              <T variant="meta" tone="lead">
                These don’t match your nationality, level or places as far as Winnow knows.
              </T>
              {other.map(row)}
            </>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
