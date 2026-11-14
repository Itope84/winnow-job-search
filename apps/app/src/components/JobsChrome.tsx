import type { ArchiveReason, JobList, JobSort, Stage, TriageVerdict } from '@winnow/api';
import {
  ARCHIVE_REASON_LABELS,
  ARCHIVE_REASONS,
  JOB_SORT_LABELS,
  JOB_SORTS,
  LIST_LABELS,
  LISTS,
  STAGE_LABELS,
  STAGES,
} from '@winnow/api';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { companyLabel } from '@/lib/format';
import { useCounts, useJobSources, useRestore, useReview } from '@/lib/hooks';
import { refreshJobs } from '@/lib/query';
import { useMode } from '@/lib/study';
import { fonts, radius, space, type, useTheme } from '@/theme';
import { Chip } from './chips';
import { Sheet } from './Sheet';
import { Button, Icon, T } from './ui';

export interface Filters {
  triage?: TriageVerdict | 'none';
  withinDays?: number;
  source?: string;
  minScore?: number;
  reason?: ArchiveReason;
  stage?: Stage;
  sort?: JobSort;
  /** Scholarships mode. */
  kind?: 'scholarship' | 'programme';
  dueWithinDays?: number;
}

/** Inbox · Shortlist · Scored · Applied · Archive, each with its live count. */
export function ListTabs({ list, onChange }: { list: JobList; onChange: (l: JobList) => void }) {
  const { c } = useTheme();
  const counts = useCounts().data;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 4 }}
      style={{ flexGrow: 0 }}
    >
      {LISTS.map((l) => {
        const on = l === list;
        return (
          <Pressable
            key={l}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(l)}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: on ? c.surfaceRaised : pressed ? c.surface : 'transparent',
                borderColor: on ? c.ruleStrong : 'transparent',
              },
            ]}
          >
            <Text
              style={{
                fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                fontSize: 14,
                color: on ? c.ink : c.lead,
              }}
            >
              {LIST_LABELS[l]}
            </Text>
            <Text
              style={{ fontFamily: fonts.mono, fontSize: 12, color: on ? c.primaryInk : c.faint }}
            >
              {counts ? counts[l].toLocaleString() : '·'}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** All · Kept · Unsure · Not triaged, for the inbox. */
export function TriageSegments({
  value,
  onChange,
}: {
  value: Filters['triage'];
  onChange: (v: Filters['triage']) => void;
}) {
  const { c } = useTheme();
  const items: [Filters['triage'], string][] = [
    [undefined, 'All'],
    ['keep', 'Kept'],
    ['unsure', 'Unsure'],
    ['none', 'Not triaged'],
  ];
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      {items.map(([v, label]) => {
        const on = value === v;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            hitSlop={6}
          >
            <Text
              style={{
                fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                fontSize: 13,
                color: on ? c.primaryInk : c.lead,
                textDecorationLine: on ? 'underline' : 'none',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const WITHIN = [undefined, 1, 3, 7, 14, 30];
const MIN_SCORES = [undefined, 3, 3.5, 4, 4.5];

function Choice<T>({
  options,
  value,
  label,
  onChange,
}: {
  options: T[];
  value: T;
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radius.base,
              borderWidth: 1,
              borderColor: on ? c.primary : c.ruleStrong,
              backgroundColor: on ? c.primarySoft : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                fontSize: 13,
                color: on ? c.primaryInk : c.ink,
              }}
            >
              {label(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FilterSheet({
  open,
  onClose,
  list,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  list: JobList;
  value: Filters;
  onChange: (f: Filters) => void;
}) {
  const sources = useJobSources().data ?? [];
  const study = useMode() === 'scholarships';
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={<Button label="Done" onPress={onClose} />}
    >
      <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
        Sort
      </T>
      <Choice<JobSort | undefined>
        options={[undefined, ...JOB_SORTS.filter((x) => study || x !== 'deadline')]}
        value={value.sort}
        label={(v) => (v ? JOB_SORT_LABELS[v] : 'Default')}
        onChange={(sort) => set({ sort })}
      />
      {study ? (
        <>
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Show
          </T>
          <Choice<Filters['kind']>
            options={[undefined, 'scholarship', 'programme']}
            value={value.kind}
            label={(v) =>
              v === 'scholarship' ? 'Scholarships' : v === 'programme' ? 'Programmes' : 'Both'
            }
            onChange={(kind) => set({ kind })}
          />
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Due within
          </T>
          <Choice
            options={[undefined, 14, 30, 60, 90]}
            value={value.dueWithinDays}
            label={(v) => (v ? `${v} days` : 'Any time')}
            onChange={(dueWithinDays) => set({ dueWithinDays })}
          />
        </>
      ) : null}
      <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
        {study ? 'Found within' : 'Posted within'}
      </T>
      <Choice
        options={WITHIN}
        value={value.withinDays}
        label={(v) => (v ? `${v} day${v === 1 ? '' : 's'}` : 'Any time')}
        onChange={(withinDays) => set({ withinDays })}
      />
      {list !== 'inbox' && list !== 'shortlist' ? (
        <>
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Minimum score
          </T>
          <Choice
            options={MIN_SCORES}
            value={value.minScore}
            label={(v) => (v ? `${v.toFixed(1)}+` : 'Any')}
            onChange={(minScore) => set({ minScore })}
          />
        </>
      ) : null}
      {list === 'archive' ? (
        <>
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Reason
          </T>
          <Choice<ArchiveReason | undefined>
            options={[undefined, ...ARCHIVE_REASONS]}
            value={value.reason}
            label={(v) => (v ? ARCHIVE_REASON_LABELS[v] : 'Any reason')}
            onChange={(reason) => set({ reason })}
          />
        </>
      ) : null}
      {list === 'applied' ? (
        <>
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Stage
          </T>
          <Choice<Stage | undefined>
            options={[undefined, ...STAGES]}
            value={value.stage}
            label={(v) => (v ? STAGE_LABELS[v] : 'Any stage')}
            onChange={(stage) => set({ stage })}
          />
        </>
      ) : null}
      {sources.length ? (
        <>
          <T variant="caps" tone="lead" style={{ marginBottom: 6 }}>
            Source
          </T>
          <Choice<string | undefined>
            options={[undefined, ...sources]}
            value={value.source}
            label={(v) => (v ? companyLabel(v) : 'Any source')}
            onChange={(source) => set({ source })}
          />
        </>
      ) : null}
    </Sheet>
  );
}

/** The active filters as removable chips. */
export function ActiveFilters({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
}) {
  const { c } = useTheme();
  const chips: [keyof Filters, string][] = [];
  if (value.kind)
    chips.push(['kind', value.kind === 'scholarship' ? 'Scholarships' : 'Programmes']);
  if (value.dueWithinDays) chips.push(['dueWithinDays', `Due ≤ ${value.dueWithinDays}d`]);
  if (value.withinDays) chips.push(['withinDays', `Posted ≤ ${value.withinDays}d`]);
  if (value.minScore) chips.push(['minScore', `Score ≥ ${value.minScore.toFixed(1)}`]);
  if (value.reason) chips.push(['reason', ARCHIVE_REASON_LABELS[value.reason]]);
  if (value.stage) chips.push(['stage', STAGE_LABELS[value.stage]]);
  if (value.source) chips.push(['source', companyLabel(value.source)]);
  if (value.sort) chips.push(['sort', `Sort: ${JOB_SORT_LABELS[value.sort]}`]);
  return (
    <>
      {chips.map(([k, label]) => (
        <Pressable
          key={k}
          onPress={() => onChange({ ...value, [k]: undefined })}
          accessibilityLabel={`Remove filter ${label}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 8,
            paddingRight: 4,
            paddingVertical: 4,
            borderRadius: radius.base,
            backgroundColor: c.primarySoft,
          }}
        >
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: c.primaryInk }}>{label}</Text>
          <Icon name="close" size={14} tone="primary" />
        </Pressable>
      ))}
    </>
  );
}

/** After a triage run: "Triage archived 14 of 40 · Review". Stays until dismissed, on any device. */
export function TriageReviewCard() {
  const { c } = useTheme();
  const review = useReview().data;
  const restore = useRestore();
  const [open, setOpen] = useState(false);
  if (!review || !review.archived.length) return null;
  const total = Number(
    (review.run.result as { total?: number } | null)?.total ?? review.run.jobIds.length,
  );
  const archived = review.archived.length;
  const dismiss = () => void api.dismissRun(review.run.id).then(refreshJobs);
  return (
    <View style={[styles.review, { backgroundColor: c.surface }]}>
      <Icon name="filter-alt" size={18} tone="lead" />
      <Text style={[type.bodySmall, { color: c.ink, flex: 1 }]}>
        Triage archived <Text style={{ fontFamily: fonts.mono }}>{archived}</Text> of{' '}
        <Text style={{ fontFamily: fonts.mono }}>{total}</Text>
        {review.run.summary ? ` · ${review.run.summary.split(' · ')[0]}` : ''}
      </Text>
      {archived ? <Button kind="ghost" label="Review" onPress={() => setOpen(true)} /> : null}
      <Pressable onPress={dismiss} accessibilityLabel="Dismiss" hitSlop={8}>
        <Icon name="close" size={18} tone="lead" />
      </Pressable>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Archived by triage · ${archived}`}
        footer={
          <Button
            kind="secondary"
            label="Looks right"
            onPress={() => {
              setOpen(false);
              dismiss();
            }}
          />
        }
      >
        {review.archived.map((j) => (
          <View key={j.id} style={[styles.reviewRow, { borderBottomColor: c.rule }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="label" numberOfLines={1} style={{ fontFamily: fonts.uiSemibold }}>
                {j.role}
              </T>
              <T variant="meta" tone="lead" numberOfLines={1}>
                {companyLabel(j.company)} · {j.location}
              </T>
              <T variant="bodySmall" tone="ink">
                {j.archiveDetail ?? j.triage?.reason}
              </T>
            </View>
            <Button kind="ghost" label="Restore" onPress={() => restore.mutate([j.id])} />
          </View>
        ))}
        {!review.archived.length ? <Chip label="Nothing left to review" /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.base,
    borderWidth: 1,
  },
  review: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 10,
    minHeight: 48,
    borderRadius: radius.lg,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
