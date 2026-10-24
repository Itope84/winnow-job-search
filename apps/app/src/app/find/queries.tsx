import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Button, Field, Header, Screen, SectionTitle, T } from '@/components/ui';
import { space } from '@/theme';

/** The searches AI search runs. */
export default function Queries() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  return (
    <Screen
      header={<Header title="AI search queries" />}
      footer={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />}
    >
      {loading || !draft ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            AI search runs each query on the web and reads the results. It costs tokens, so keep the
            list focused.
          </T>
          <SectionTitle>Add a query</SectionTitle>
          <Field label="Name">
            <Input value={name} onChangeText={setName} placeholder="UK charity fundraising" />
          </Field>
          <Field label="Search">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={'"Trusts and Foundations Manager" charity London'}
            />
          </Field>
          <Button
            kind="secondary"
            label="Add"
            disabled={!query.trim()}
            onPress={() => {
              update((s) => ({
                ...s,
                queries: [
                  ...s.queries,
                  {
                    name: name.trim() || query.trim().slice(0, 40),
                    query: query.trim(),
                    enabled: true,
                  },
                ],
              }));
              setName('');
              setQuery('');
            }}
          />
          <SectionTitle>{`Queries · ${draft.queries.length}`}</SectionTitle>
          {draft.queries.map((qq, i) => (
            <ToggleRow
              key={`${qq.name}-${i}`}
              title={qq.name}
              subtitle={qq.query}
              value={qq.enabled}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  queries: s.queries.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                }))
              }
              onRemove={() =>
                update((s) => ({ ...s, queries: s.queries.filter((_, j) => j !== i) }))
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
