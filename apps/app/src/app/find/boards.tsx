import { View } from 'react-native';
import { Loading, SaveBar, ToggleRow, useSourcesDraft } from '@/components/SourceEditors';
import { Header, Screen, SectionTitle, T } from '@/components/ui';
import { space } from '@/theme';

/** Job boards and aggregators: one query across many employers each. */
export default function Boards() {
  const { draft, update, save, dirty, saving, loading } = useSourcesDraft();
  return (
    <Screen
      header={<Header title="Job boards" />}
      footer={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />}
    >
      {loading || !draft ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            Each board runs one search across many employers. Your rules still decide what reaches
            the inbox. LinkedIn stays off unless you turn it on: it limits unsigned-in searches.
          </T>
          <SectionTitle>{`Boards · ${draft.boards.length}`}</SectionTitle>
          {draft.boards.map((b, i) => (
            <ToggleRow
              key={`${b.name}-${i}`}
              title={b.name}
              subtitle={[
                b.provider,
                ...[b.what_or, b.keywords, b.where, b.location, b.countries].map((v) =>
                  typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : null,
                ),
              ]
                .filter(Boolean)
                .join(' · ')}
              value={b.enabled !== false}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  boards: s.boards.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                }))
              }
            />
          ))}
          {!draft.boards.length ? (
            <T variant="bodySmall" tone="lead">
              No boards yet. Import from career-ops brings yours over.
            </T>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
