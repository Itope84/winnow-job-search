import type { Job, JobList } from '@winnow/api';
import { costEstimate } from '@winnow/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddJobSheet } from '@/components/AddJobSheet';
import { Input } from '@/components/inputs';
import { ArchiveSheet, JobDetailView } from '@/components/JobDetail';
import { JobRow, type RowActions } from '@/components/JobRow';
import {
  ActiveFilters,
  FilterSheet,
  type Filters,
  ListTabs,
  TriageReviewCard,
  TriageSegments,
} from '@/components/JobsChrome';
import { LiveStrip } from '@/components/runs';
import { Button, Empty, IconButton, Loading, Notice, T } from '@/components/ui';
import {
  useCounts,
  useJob,
  useJobPages,
  useMe,
  useMove,
  useRestore,
  useShortlistKept,
  useStartRun,
} from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { useMode } from '@/lib/study';
import { fonts, space, TAB_HEIGHT, type, useTheme, useWide } from '@/theme';

const EMPTY: Record<JobList, { title: string; body: string }> = {
  inbox: {
    title: 'Inbox is clear',
    body: 'New jobs from scans land here. Run a scan from Find, or add a job by hand.',
  },
  shortlist: {
    title: 'Nothing shortlisted',
    body: 'Swipe a job right in Inbox to save it for scoring.',
  },
  scored: {
    title: 'No scores yet',
    body: 'Score a shortlisted job to see how well it fits your CV.',
  },
  applied: { title: 'No applications yet', body: 'Mark a scored job as applied to track it here.' },
  archive: {
    title: 'Archive is empty',
    body: 'Jobs you or triage set aside land here, always with a reason.',
  },
};

const EMPTY_STUDY: Record<JobList, { title: string; body: string }> = {
  inbox: {
    title: 'Inbox is clear',
    body: 'New scholarships and programmes from scans land here. Run a scan from Find, or paste a link.',
  },
  shortlist: {
    title: 'Nothing shortlisted',
    body: 'Swipe an item right in Inbox to save it for scoring.',
  },
  scored: { title: 'No scores yet', body: 'Score a shortlisted item to see how well it fits you.' },
  applied: {
    title: 'No applications yet',
    body: 'Mark a scored item as applied, and track each part in its Plan.',
  },
  archive: {
    title: 'Archive is empty',
    body: 'Items you or triage set aside land here, always with a reason.',
  },
};

export default function JobsScreen() {
  const { c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ list?: string; job?: string }>();
  const lastList = usePrefs((s) => s.lastList);
  const setLastList = usePrefs((s) => s.setLastList);
  const setSetupLater = usePrefs((s) => s.setSetupLater);
  const me = useMe().data;
  const study = useMode() === 'scholarships';
  const empty = study ? EMPTY_STUDY : EMPTY;
  const [list, setList] = useState<JobList>((params.list as JobList) || lastList || 'inbox');
  const [filters, setFilters] = useState<Filters>({});
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.job ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState<Job[] | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const move = useMove();
  const restore = useRestore();
  const start = useStartRun();
  const shortlistKept = useShortlistKept();
  const counts = useCounts().data;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const changeList = (l: JobList) => {
    setList(l);
    setLastList(l);
    setChecked(new Set());
    setFilters((f) => ({
      sort: f.sort,
      withinDays: f.withinDays,
      source: f.source,
      kind: f.kind,
      dueWithinDays: f.dueWithinDays,
    }));
  };

  const query = useMemo(
    () => ({ list, q: debounced || undefined, ...filters }),
    [list, debounced, filters],
  );
  const pages = useJobPages(query);
  const jobs = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;
  const selecting = checked.size > 0;

  // Desktop: keep a job open in the pane.
  useEffect(() => {
    if (wide && !selected && jobs[0]) setSelected(jobs[0].id);
  }, [wide, jobs, selected]);

  const open = useCallback(
    (job: Job) => {
      if (wide) setSelected(job.id);
      else router.push(`/job/${job.id}` as never);
    },
    [wide],
  );

  const toggle = useCallback((id: string) => {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** After a job leaves the list, keep the pane on its neighbour. */
  const advance = useCallback(
    (id: string) => {
      if (!wide || selected !== id) return;
      const i = jobs.findIndex((j) => j.id === id);
      setSelected(jobs[i + 1]?.id ?? jobs[i - 1]?.id ?? null);
    },
    [wide, selected, jobs],
  );

  const actionsFor = useCallback(
    (job: Job): RowActions => {
      const mv =
        (to: JobList, extra: object = {}) =>
        () => {
          advance(job.id);
          move.mutate({ ids: [job.id], to, before: [job], ...extra });
        };
      const archive = {
        label: 'Archive',
        icon: 'archive' as const,
        run: mv('archive', { reason: 'not_for_me' }),
      };
      switch (job.list) {
        case 'inbox':
          return {
            primary: { label: 'Shortlist', icon: 'bookmark-add', run: mv('shortlist') },
            secondary: archive,
          };
        case 'shortlist':
          return {
            primary: {
              label: 'Score',
              icon: 'insights',
              run: () => start.mutate({ kind: 'score', jobIds: [job.id] }),
            },
            secondary: archive,
          };
        case 'scored':
          return {
            primary: {
              label: 'Mark applied',
              icon: 'check',
              run: mv('applied', { stage: 'applied' }),
            },
            secondary: archive,
          };
        case 'applied':
          return {
            secondary: {
              label: 'Rejected',
              icon: 'archive',
              run: mv('archive', { reason: 'rejected' }),
            },
          };
        default:
          return {
            primary: {
              label: 'Restore',
              icon: 'unarchive',
              run: () => {
                advance(job.id);
                restore.mutate([job.id]);
              },
            },
          };
      }
    },
    [move, restore, start, advance],
  );

  // Desktop keys: j/k move, s main action, a archive, enter open, n add, / search.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    if (Platform.OS !== 'web' || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const list = jobsRef.current;
      const i = list.findIndex((j) => j.id === selected);
      const cur = list[i];
      if (e.key === 'j' || e.key === 'ArrowDown') {
        const n = list[Math.min(list.length - 1, i + 1)];
        if (n) setSelected(n.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        const n = list[Math.max(0, i - 1)];
        if (n) setSelected(n.id);
      } else if (e.key === 's' && cur) actionsFor(cur).primary?.run();
      else if (e.key === 'a' && cur) actionsFor(cur).secondary?.run();
      else if (e.key === 'Enter' && cur) router.push(`/job/${cur.id}` as never);
      else if (e.key === 'n') setAdding(true);
      else if (e.key === '/') {
        setSearching(true);
        e.preventDefault();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide, selected, actionsFor]);

  const checkedJobs = jobs.filter((j) => checked.has(j.id));
  const untriaged = list === 'inbox' ? jobs.filter((j) => !j.triage).length : 0;

  // Stays put while the list scrolls: the app's name and the list actions.
  const topBar = (
    <View
      style={{
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: scrolled ? c.rule : 'transparent',
        backgroundColor: c.canvas,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View
          accessibilityRole="header"
          accessibilityLabel="Winnow"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          {wide ? null : (
            <Image
              source={require('../../assets/images/icon.png')}
              style={{ width: 30, height: 30, borderRadius: 7 }}
            />
          )}
          <Text style={[type.title, { color: c.ink, fontSize: 24, letterSpacing: -0.3 }]}>
            winnow
          </Text>
        </View>
        {!wide ? (
          <IconButton name="search" label="Search" onPress={() => setSearching((s) => !s)} />
        ) : null}
        <IconButton name="tune" label="Filters" onPress={() => setFilterOpen(true)} />
        <IconButton
          name="add"
          label={study ? 'Add a link' : 'Add a job'}
          onPress={() => setAdding(true)}
          filled
        />
      </View>
      {wide || searching ? (
        <Input
          value={q}
          onChangeText={setQ}
          placeholder={
            study ? 'Search name, university or country' : 'Search role, company or place'
          }
          autoFocus={searching && !wide}
          returnKeyType="search"
        />
      ) : null}
    </View>
  );

  const header = (
    <View
      style={{
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingTop: space.xs,
        paddingBottom: space.sm,
      }}
    >
      {me && me.setup !== 'done' ? (
        <Notice
          tone="info"
          icon="assignment-ind"
          title="Finish setting up"
          body="Triage and scoring need your CV and profile. Setup takes about 10 minutes."
          action={
            <View style={{ flexDirection: 'row' }}>
              <Button
                kind="secondary"
                label="Continue setup"
                onPress={() => {
                  setSetupLater(null);
                  router.push('/setup' as never);
                }}
              />
            </View>
          }
        />
      ) : null}
      <LiveStrip />
      <ListTabs list={list} onChange={changeList} />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          minHeight: 28,
        }}
      >
        {list === 'inbox' ? (
          <TriageSegments
            value={filters.triage}
            onChange={(triage) => setFilters({ ...filters, triage })}
          />
        ) : null}
        <ActiveFilters value={filters} onChange={setFilters} />
        <View style={{ flex: 1 }} />
        <Text style={[type.mono, { color: c.faint }]}>{total.toLocaleString()} shown</Text>
      </View>
      {list === 'inbox' ? <TriageReviewCard /> : null}
      {list === 'inbox' && counts?.kept ? (
        <ListAction
          label={`Shortlist ${counts.kept} kept`}
          note="Every job triage kept moves to Shortlist"
          busy={shortlistKept.isPending}
          onPress={() => shortlistKept.mutate()}
        />
      ) : null}
      {list === 'inbox' && counts?.inbox ? (
        <ListAction
          label="Triage inbox"
          note={`${study ? 'Items' : 'Jobs'} without a verdict · uses tokens · ${costEstimate('triage', study ? 'scholarships' : 'jobs')}`}
          busy={start.isPending}
          onPress={() => start.mutate({ kind: 'triage', scope: 'untriaged' })}
          disabled={untriaged === 0 && !pages.hasNextPage}
        />
      ) : null}
      {list === 'shortlist' && jobs.length ? (
        <ListAction
          label={`Score all ${total}`}
          note={`Uses tokens · ${costEstimate('score', study ? 'scholarships' : 'jobs')} · runs a few at a time`}
          busy={start.isPending}
          onPress={() =>
            start.mutate({
              kind: 'score',
              jobIds: jobs.filter((j) => !j.activity).map((j) => j.id),
            })
          }
        />
      ) : null}
    </View>
  );

  const bulkBar = selecting ? (
    <View
      style={[
        styles.bulk,
        {
          backgroundColor: c.surfaceRaised,
          borderColor: c.ruleStrong,
          bottom: (wide ? 0 : TAB_HEIGHT) + insets.bottom + space.sm,
        },
      ]}
    >
      <IconButton name="close" label="Clear selection" onPress={() => setChecked(new Set())} />
      <Text style={[type.label, { color: c.ink, flex: 1 }]}>{checked.size} selected</Text>
      {list === 'inbox' ? (
        <Button
          kind="ghost"
          label="Triage"
          onPress={() => {
            start.mutate({ kind: 'triage', jobIds: [...checked] });
            setChecked(new Set());
          }}
        />
      ) : null}
      {list === 'inbox' ? (
        <Button
          kind="ghost"
          label="Shortlist"
          onPress={() => {
            move.mutate({ ids: [...checked], to: 'shortlist', before: checkedJobs });
            setChecked(new Set());
          }}
        />
      ) : null}
      {list === 'inbox' || list === 'shortlist' || list === 'scored' ? (
        <Button
          kind="ghost"
          label="Score"
          onPress={() => {
            start.mutate({ kind: 'score', jobIds: [...checked] });
            setChecked(new Set());
          }}
        />
      ) : null}
      {list === 'archive' ? (
        <Button
          kind="ghost"
          label="Restore"
          onPress={() => {
            restore.mutate([...checked]);
            setChecked(new Set());
          }}
        />
      ) : (
        <Button kind="ghost" label="Archive" onPress={() => setArchiving(checkedJobs)} />
      )}
    </View>
  ) : null;

  const listView = (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.id}
      renderItem={({ item }) => (
        <JobRow
          job={item}
          actions={actionsFor(item)}
          onPress={() => open(item)}
          selected={wide && item.id === selected}
          selecting={selecting}
          checked={checked.has(item.id)}
          onToggle={() => toggle(item.id)}
          wide={wide}
        />
      )}
      ListHeaderComponent={header}
      onScroll={(e) => {
        const past = e.nativeEvent.contentOffset.y > 4;
        if (past !== scrolled) setScrolled(past);
      }}
      scrollEventThrottle={64}
      ListEmptyComponent={
        pages.isLoading ? (
          <Loading />
        ) : pages.error ? (
          <Empty
            icon="cloud-off"
            title={study ? 'Couldn’t load items' : 'Couldn’t load jobs'}
            body={(pages.error as Error).message}
            action={<Button label="Try again" onPress={() => void pages.refetch()} />}
          />
        ) : (
          <Empty
            icon="inbox"
            title={
              debounced || Object.values(filters).some(Boolean)
                ? study
                  ? 'Nothing matches'
                  : 'No jobs match'
                : empty[list].title
            }
            body={
              debounced || Object.values(filters).some(Boolean)
                ? 'Try clearing the search or filters.'
                : empty[list].body
            }
          />
        )
      }
      ListFooterComponent={
        pages.isFetchingNextPage ? (
          <ActivityIndicator style={{ margin: space.lg }} color={c.lead} />
        ) : jobs.length && !pages.hasNextPage ? (
          <T variant="meta" tone="faint" style={{ textAlign: 'center', padding: space.lg }}>
            {wide ? 'j/k move · s main action · a archive · n add · enter open' : `End of ${list}`}
          </T>
        ) : null
      }
      onEndReached={() => {
        if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
      }}
      onEndReachedThreshold={0.6}
      contentContainerStyle={{
        paddingBottom: (wide ? 0 : TAB_HEIGHT) + insets.bottom + (selecting ? 80 : space.lg),
      }}
      refreshing={pages.isRefetching && !pages.isFetchingNextPage}
      onRefresh={() => void pages.refetch()}
      initialNumToRender={14}
      windowSize={9}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top }}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: 460,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: c.rule,
            }}
          >
            {topBar}
            {listView}
          </View>
          <DetailPane id={selected} onGone={() => selected && advance(selected)} />
        </View>
      ) : (
        <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          {topBar}
          {listView}
        </View>
      )}
      {bulkBar}
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        list={list}
        value={filters}
        onChange={setFilters}
      />
      <AddJobSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={wide ? (id) => setSelected(id) : undefined}
      />
      <ArchiveSheet
        jobs={archiving ?? []}
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onDone={() => setChecked(new Set())}
      />
    </View>
  );
}

function ListAction({
  label,
  note,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  note: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Pressable
        onPress={onPress}
        disabled={busy || disabled}
        accessibilityRole="button"
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: c.ruleStrong,
          backgroundColor: pressed ? c.surface : 'transparent',
          opacity: disabled ? 0.45 : 1,
        })}
      >
        <Text style={{ fontFamily: fonts.uiSemibold, fontSize: 13.5, color: c.ink }}>
          {busy ? 'Working…' : label}
        </Text>
      </Pressable>
      <T variant="meta" tone="faint" style={{ flex: 1 }} numberOfLines={1}>
        {note}
      </T>
    </View>
  );
}

function DetailPane({ id, onGone }: { id: string | null; onGone: () => void }) {
  const { c } = useTheme();
  const job = useJob(id);
  return (
    <View style={{ flex: 1 }}>
      {!id ? (
        <Empty
          icon="work-outline"
          title="Pick a job"
          body="Its details, score and report show here."
        />
      ) : job.isLoading ? (
        <Loading />
      ) : job.data ? (
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingLeft: space.xl,
            maxWidth: 780,
            width: '100%',
          }}
          style={{ backgroundColor: c.canvas }}
        >
          <JobDetailView job={job.data} onGone={onGone} />
        </ScrollView>
      ) : (
        <Empty
          icon="error-outline"
          title="Couldn’t load this job"
          body={(job.error as Error | null)?.message}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bulk: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: space.xs,
    minHeight: 52,
    maxWidth: 720,
    alignSelf: 'center',
  },
});
