import type { CountryCoverage, CoverageLayer } from '@winnow/api';
import { COVERAGE_LAYER_LABELS } from '@winnow/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Chip } from '@/components/chips';
import { Header, Icon, Loading, Notice, Screen, SectionTitle, T } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useCoverage } from '@/lib/hooks';
import { radius, space, type, useTheme } from '@/theme';

const STANCE = {
  prefer: 'Preferred',
  allow: 'Allowed',
  exclude: 'Excluded',
  other: 'Not on your list',
} as const;
const BAND = { free: 'Tuition-free', low: 'Low fees', fees: 'Fees' } as const;

function CountryCard({ row }: { row: CountryCoverage }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const f = row.facts;
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.lg,
        padding: space.md,
        marginBottom: space.sm,
        gap: 6,
        opacity: row.stance === 'exclude' ? 0.55 : 1,
      }}
    >
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[type.title, { color: c.ink, flex: 1 }]}>{f.name}</Text>
          <Chip
            label={BAND[f.tuitionBand]}
            tone={
              f.tuitionBand === 'free' ? 'sage' : f.tuitionBand === 'low' ? 'primary' : 'neutral'
            }
          />
          <Icon name={open ? 'expand-less' : 'expand-more'} tone="faint" />
        </View>
        <T variant="meta" tone="lead">
          {[
            STANCE[row.stance],
            row.checkedAt
              ? `swept ${timeAgo(row.checkedAt)} ago`
              : row.stance === 'exclude'
                ? null
                : 'not swept yet',
            `${row.open} open`,
            row.best != null ? `best ${row.best.toFixed(1)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
        {row.note ? (
          <T variant="bodySmall" tone="lead">
            {row.note}
          </T>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <T variant="bodySmall">Tuition: {f.tuition}</T>
          <T variant="bodySmall">Living: {f.living}</T>
          {f.schemes.length ? <T variant="bodySmall">Schemes: {f.schemes.join(' · ')}</T> : null}
          {f.grants.length ? <T variant="bodySmall">Grants: {f.grants.join(' · ')}</T> : null}
          {f.postStudyWork ? <T variant="bodySmall">After study: {f.postStudyWork}</T> : null}
          {f.notes ? (
            <T variant="bodySmall" tone="lead">
              {f.notes}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {f.portals.map((p) => (
              <Pressable
                key={p.url}
                onPress={() => void Linking.openURL(p.url)}
                accessibilityRole="link"
              >
                <T variant="label" tone="primary">
                  {p.name} ↗
                </T>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** What the scans have looked at: every place, scheme, university page, feed and search. */
export default function Coverage() {
  const { c } = useTheme();
  const q = useCoverage();
  const data = q.data;
  const layers = [...new Set(data?.rows.map((r) => r.layer) ?? [])] as CoverageLayer[];
  return (
    <Screen header={<Header title="Coverage" />}>
      {!data ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <T variant="bodySmall" tone="lead">
            Where Winnow has looked and what turned up. A place with nothing open has still been
            checked: the note says what was looked at.
          </T>
          {data.catalogue ? (
            <View style={{ marginTop: space.md }}>
              <Notice
                icon="lightbulb-outline"
                title={`${data.catalogue} known page${data.catalogue === 1 ? '' : 's'} you haven’t added`}
                body="Schemes and university award pages Winnow knows that suit you."
                action={
                  <Pressable onPress={() => router.push('/find/pages' as never)}>
                    <T variant="label" tone="primary">
                      See them
                    </T>
                  </Pressable>
                }
              />
            </View>
          ) : null}
          <SectionTitle>Places</SectionTitle>
          {data.countries.map((row) => (
            <CountryCard key={row.facts.name} row={row} />
          ))}
          {layers.map((layer) => (
            <View key={layer}>
              <SectionTitle>{COVERAGE_LAYER_LABELS[layer]}</SectionTitle>
              {data.rows
                .filter((r) => r.layer === layer)
                .map((r) => (
                  <View
                    key={`${r.layer}-${r.target}`}
                    style={{
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: c.rule,
                      gap: 2,
                    }}
                  >
                    <T variant="label" numberOfLines={1}>
                      {r.target}
                    </T>
                    <Text style={[type.mono, { color: c.lead }]}>
                      {[
                        r.checkedAt ? `${timeAgo(r.checkedAt)} ago` : 'never',
                        `${r.found} seen`,
                        `${r.added} new`,
                        `${r.open} open`,
                        r.note || null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
