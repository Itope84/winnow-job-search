import type { ArchiveReason, Job, JobDetail as JobDetailT, ScoreResult, Stage } from '@winnow/api';
import { ARCHIVE_REASON_LABELS, LIST_LABELS, RUN_COSTS, STAGE_LABELS, STAGES } from '@winnow/api';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { companyLabel, dateLabel, deadline, isStale, timeAgo } from '@/lib/format';
import { useActiveRuns, useMove, useRestore, useStartRun } from '@/lib/hooks';
import { refreshJobs } from '@/lib/query';
import { toast } from '@/lib/toast';
import { fonts, radius, space, type, useTheme } from '@/theme';
import { ApplicationPane } from './ApplicationPane';
import { Chip, ScoreChip } from './chips';
import { Input } from './inputs';
import { CompanyTile } from './JobRow';
import { Markdown } from './Markdown';
import { RunCard } from './runs';
import { Sheet } from './Sheet';
import { Button, Divider, Icon, Notice, T } from './ui';

const MOVER: Record<Job['movedBy'], string> = {
  you: 'you',
  triage: 'Triage',
  rules: 'your rules',
  score: 'Score',
  scan: 'a scan',
  import: 'the career-ops import',
  server: 'Winnow',
};

export function statusLine(job: Job): string {
  const when = timeAgo(job.movedAt);
  if (job.list === 'archive')
    return `Archived by ${MOVER[job.movedBy]}${when ? `, ${when} ago` : ''}: ${job.archiveDetail ?? (job.archiveReason ? ARCHIVE_REASON_LABELS[job.archiveReason] : '')}`;
  const list =
    job.list === 'applied' && job.stage
      ? `Applied · ${STAGE_LABELS[job.stage]}`
      : LIST_LABELS[job.list];
  return `${list} · moved by ${MOVER[job.movedBy]}${when && when !== 'just now' ? `, ${when} ago` : ''}`;
}

/** Big score, verdict, the five dimensions, then stops, gaps, strengths and the next step. */
export function ScoreCard({ score }: { score: ScoreResult }) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 40, lineHeight: 44, color: c.ink }}>
          {score.score.toFixed(1)}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 16, color: c.faint, marginBottom: 6 }}>
          /5
        </Text>
        <View style={{ flex: 1 }} />
        <ScoreChip score={score.score} verdict={score.verdict} />
      </View>
      {score.summary ? (
        <Text style={[type.reading, { color: c.ink, marginTop: space.sm }]}>{score.summary}</Text>
      ) : null}
      {score.dimensions.length ? (
        <View style={{ gap: 10, marginTop: space.md }}>
          {score.dimensions.map((d) => (
            <View key={d.key} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T variant="label">{d.label}</T>
                <Text style={[type.mono, { color: c.ink }]}>
                  {d.score != null ? d.score.toFixed(1) : '–'}
                </Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: c.rule }}>
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    width: `${((d.score ?? 0) / 5) * 100}%`,
                    backgroundColor: c.primary,
                  }}
                />
              </View>
              {d.note ? (
                <T variant="meta" tone="lead" numberOfLines={2}>
                  {d.note}
                </T>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Points title="Hard stops" items={score.hardStops} tone="danger" empty="None" />
        <Points title="Gaps" items={score.gaps} tone="amber" />
        <Points title="Strengths" items={score.strengths} tone="sage" />
      </View>
      {score.nextStep ? (
        <View style={[styles.next, { borderLeftColor: c.primary, backgroundColor: c.canvas }]}>
          <Text
            style={[
              type.reading,
              { color: c.ink, fontFamily: fonts.contentItalic, fontSize: 15.5, lineHeight: 23 },
            ]}
          >
            Next step: {score.nextStep}
          </Text>
        </View>
      ) : null}
      {score.legitimacy || score.comp ? (
        <T variant="meta" tone="faint" style={{ marginTop: space.sm }}>
          {[
            score.legitimacy ? `Posting: ${score.legitimacy}` : null,
            score.comp ? `Pay: ${score.comp}` : null,
            `Scored ${timeAgo(score.at)} ago`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
      ) : null}
    </View>
  );
}

function Points({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: 'danger' | 'amber' | 'sage';
  empty?: string;
}) {
  const { c } = useTheme();
  if (!items.length && !empty) return null;
  const color = { danger: c.dangerText, amber: c.amberText, sage: c.sageText }[tone];
  return (
    <View style={{ gap: 3 }}>
      <Text style={[type.caps, { color }]}>{title}</Text>
      {items.length ? (
        items.map((it) => (
          <View key={it} style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={[type.bodySmall, { color: c.lead }]}>•</Text>
            <Text style={[type.bodySmall, { color: c.ink, flex: 1 }]}>{it}</Text>
          </View>
        ))
      ) : (
        <T variant="bodySmall" tone="lead">
          {empty}
        </T>
      )}
    </View>
  );
}

const ARCHIVE_CHOICES: Record<string, ArchiveReason[]> = {
  applied: ['rejected', 'withdrew', 'closed', 'not_for_me'],
  default: ['not_for_me', 'low_score', 'closed', 'duplicate'],
};

/** Pick why a job is set aside. Every archived job keeps a reason. */
export function ArchiveSheet({
  jobs,
  open,
  onClose,
  onDone,
}: {
  jobs: Job[];
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const move = useMove();
  const [reason, setReason] = useState<ArchiveReason>('not_for_me');
  const [detail, setDetail] = useState('');
  const choices = jobs.every((j) => j.list === 'applied')
    ? ARCHIVE_CHOICES.applied
    : ARCHIVE_CHOICES.default;
  useEffect(() => {
    if (open) {
      setReason(choices?.[0] ?? 'not_for_me');
      setDetail('');
    }
  }, [open]);
  const { c } = useTheme();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={jobs.length > 1 ? `Archive ${jobs.length} jobs` : 'Archive'}
      footer={
        <Button
          label="Archive"
          icon="archive"
          onPress={() => {
            move.mutate({
              ids: jobs.map((j) => j.id),
              to: 'archive',
              reason,
              detail: detail.trim() || undefined,
              before: jobs,
            });
            onClose();
            onDone?.();
          }}
        />
      }
    >
      <T variant="bodySmall" tone="lead" style={{ marginBottom: space.sm }}>
        Why? The reason stays with the job, and you can restore it from Archive.
      </T>
      {(choices ?? []).map((r) => (
        <Pressable
          key={r}
          onPress={() => setReason(r)}
          accessibilityRole="radio"
          accessibilityState={{ checked: reason === r }}
          style={({ pressed }) => [
            styles.choice,
            { backgroundColor: pressed ? c.surface : 'transparent' },
          ]}
        >
          <Icon
            name={reason === r ? 'radio-button-checked' : 'radio-button-unchecked'}
            tone={reason === r ? 'primary' : 'faint'}
          />
          <T variant="body">{ARCHIVE_REASON_LABELS[r]}</T>
        </Pressable>
      ))}
      <Input
        value={detail}
        onChangeText={setDetail}
        placeholder="Add a note (optional)"
        style={{ marginTop: space.sm }}
      />
    </Sheet>
  );
}

/** What reading the posting found: a deadline, text that tried to steer the AI, a failed read. */
function PostingNotes({ job }: { job: Job }) {
  const { c } = useTheme();
  const p = job.posting;
  const due = deadline(job);
  if (!p || (!p.warnings.length && !due && !p.unreachable)) return null;
  return (
    <View style={{ gap: space.sm }}>
      {p.warnings.length ? (
        <View style={[styles.status, { backgroundColor: c.amberSoft, alignItems: 'flex-start' }]}>
          <Icon name="warning-amber" size={16} color={c.amberText} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[type.bodySmall, { color: c.ink }]}>
              This posting has text aimed at AI tools or hidden from readers. Winnow removed what
              was hidden and told triage and scoring not to follow it. Read it yourself before
              applying.
            </Text>
            {p.warnings.map((w) => (
              <Text key={w} style={[type.meta, { color: c.lead }]}>
                {w}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {due ? (
        <T variant="bodySmall" tone={due.soon ? 'primary' : 'lead'}>
          {due.soon ? '🔥 ' : ''}
          {due.label}
        </T>
      ) : null}
      {p.unreachable ? (
        <T variant="bodySmall" tone="lead">
          Winnow couldn’t read the posting last time ({p.unreachable}). It stays here and is read
          again next time.
        </T>
      ) : null}
    </View>
  );
}

type Tab = 'report' | 'application' | 'description' | 'timeline' | 'notes';

/** Everything about one job. Used by the phone page and the desktop detail pane. */
export function JobDetailView({ job, onGone }: { job: JobDetailT; onGone?: () => void }) {
  const { c } = useTheme();
  const move = useMove();
  const restore = useRestore();
  const start = useStartRun();
  const runs = useActiveRuns().data ?? [];
  const activeRun = job.activity ? runs.find((r) => r.id === job.activity?.runId) : undefined;
  const [archiving, setArchiving] = useState(false);
  const [tab, setTab] = useState<Tab>(job.report ? 'report' : 'description');
  useEffect(() => setTab(job.report ? 'report' : 'description'), [job.id, !!job.report]);

  const to = (list: Job['list'], stage?: Stage) =>
    move.mutate({ ids: [job.id], to: list, stage, before: [job] });
  const scoreIt = () => start.mutate({ kind: 'score', jobIds: [job.id] });
  const busy = !!job.activity;

  const facts = [
    job.workModel,
    job.salary,
    ...[...new Set(job.sources.map((s) => s.source))].slice(0, 3),
  ].filter((x): x is string => !!x);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.sm }}>
        <CompanyTile company={job.company} size={48} />
        <Text style={[type.headline, { color: c.ink }]}>{job.role || 'Untitled role'}</Text>
        <Text style={[type.bodySmall, { color: c.lead }]}>
          {[
            companyLabel(job.company),
            job.location,
            job.postedAt
              ? `Posted ${timeAgo(job.postedAt)} ago${isStale(job) ? ', may be stale' : ''}`
              : `Found ${timeAgo(job.firstSeen)} ago`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {facts.map((f) => (
            <Chip key={f} label={f} />
          ))}
          {/^https?:/.test(job.url) ? (
            <Pressable
              onPress={() => void Linking.openURL(job.url)}
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}
            >
              <T variant="label" tone="primary">
                Open posting
              </T>
              <Icon name="open-in-new" size={16} tone="primary" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.status, { backgroundColor: c.surface }]}>
        <Icon name={job.list === 'archive' ? 'archive' : 'info-outline'} size={16} tone="lead" />
        <Text style={[type.bodySmall, { color: c.ink, flex: 1 }]}>{statusLine(job)}</Text>
      </View>
      <PostingNotes job={job} />
      {job.triage && job.list !== 'archive' ? (
        <T variant="bodySmall" tone="lead">
          Triage:{' '}
          {job.triage.verdict === 'keep'
            ? 'Kept'
            : job.triage.verdict === 'unsure'
              ? 'Unsure'
              : 'Discard'}
          {job.triage.reason ? ` — ${job.triage.reason}` : ''}
        </T>
      ) : null}

      {activeRun ? <RunCard run={activeRun} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {job.list === 'inbox' ? (
          <>
            <Button label="Shortlist" icon="bookmark-add" onPress={() => to('shortlist')} />
            <Button
              kind="secondary"
              label="Score"
              icon="insights"
              disabled={busy}
              onPress={scoreIt}
            />
            <Button
              kind="secondary"
              label="Archive"
              icon="archive"
              onPress={() => setArchiving(true)}
            />
          </>
        ) : job.list === 'shortlist' ? (
          <>
            <Button
              label={busy ? 'Scoring…' : 'Score'}
              icon="insights"
              disabled={busy}
              onPress={scoreIt}
            />
            <Button kind="secondary" label="Back to Inbox" onPress={() => to('inbox')} />
            <Button
              kind="secondary"
              label="Archive"
              icon="archive"
              onPress={() => setArchiving(true)}
            />
          </>
        ) : job.list === 'scored' ? (
          <>
            <Button label="Mark applied" icon="check" onPress={() => to('applied', 'applied')} />
            <Button
              kind="secondary"
              label={busy ? 'Scoring…' : 'Rescore'}
              icon="refresh"
              disabled={busy}
              onPress={scoreIt}
            />
            <Button
              kind="secondary"
              label="Archive"
              icon="archive"
              onPress={() => setArchiving(true)}
            />
          </>
        ) : job.list === 'applied' ? (
          <>
            {STAGES.map((s) => (
              <Button
                key={s}
                kind={job.stage === s ? 'primary' : 'secondary'}
                label={STAGE_LABELS[s]}
                onPress={() => {
                  if (job.stage === s) return;
                  void api
                    .updateJob(job.id, { stage: s })
                    .then(refreshJobs, (e) => toast.show((e as Error).message));
                }}
              />
            ))}
            <Button
              kind="secondary"
              label="Archive"
              icon="archive"
              onPress={() => setArchiving(true)}
            />
          </>
        ) : (
          <Button
            label="Restore"
            icon="unarchive"
            onPress={() => restore.mutate([job.id], { onSuccess: onGone })}
          />
        )}
      </View>
      {job.list === 'inbox' || job.list === 'shortlist' ? (
        <T variant="meta" tone="faint">
          Scoring uses tokens · {RUN_COSTS.score.estimate}
        </T>
      ) : null}

      {job.score ? <ScoreCard score={job.score} /> : null}

      <View
        style={{
          flexDirection: 'row',
          gap: space.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.rule,
        }}
      >
        {(
          [
            ['report', 'Report'],
            ['application', 'CV & letter'],
            ['description', 'Description'],
            ['timeline', 'Timeline'],
            ['notes', 'Notes'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{
              paddingVertical: 10,
              borderBottomWidth: 2,
              borderBottomColor: tab === t ? c.primary : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: tab === t ? fonts.uiSemibold : fonts.uiMedium,
                fontSize: 14,
                color: tab === t ? c.primaryInk : c.lead,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'report' ? (
        job.report ? (
          <Markdown text={job.report} />
        ) : (
          <Notice
            title="No report yet"
            body={
              job.score
                ? 'This score came without a full report.'
                : 'Score this job to get a full report.'
            }
          />
        )
      ) : tab === 'application' ? (
        <ApplicationPane job={job} />
      ) : tab === 'description' ? (
        job.jd ? (
          <Markdown text={job.jd} />
        ) : (
          <Notice
            title="No description captured"
            body="Open the posting to read it, or score the job: scoring reads the page first."
          />
        )
      ) : tab === 'timeline' ? (
        <View style={{ gap: 0 }}>
          {job.timeline.map((t, i) => (
            <View
              key={`${t.at}-${i}`}
              style={{ flexDirection: 'row', gap: space.md, paddingVertical: 8 }}
            >
              <View style={{ alignItems: 'center', width: 10 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginTop: 6,
                    backgroundColor: i === job.timeline.length - 1 ? c.primary : c.ruleStrong,
                  }}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodySmall">{t.text}</T>
                <Text style={[type.mono, { color: c.faint }]}>{dateLabel(t.at)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Notes job={job} />
      )}

      <Divider />
      <T variant="meta" tone="faint">
        First seen {dateLabel(job.firstSeen)}
        {job.sources.length > 1 ? ` · seen on ${job.sources.length} sources` : ''}
      </T>
      <ArchiveSheet
        jobs={[job]}
        open={archiving}
        onClose={() => setArchiving(false)}
        onDone={onGone}
      />
    </View>
  );
}

function Notes({ job }: { job: Job }) {
  const [text, setText] = useState(job.notes);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setText(job.notes);
    setSaved(true);
  }, [job.id]);
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(() => {
      void api.updateJob(job.id, { notes: text }).then(
        () => setSaved(true),
        (e) => toast.show((e as Error).message),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [text, saved, job.id]);
  return (
    <View style={{ gap: 6 }}>
      <Input
        area
        value={text}
        onChangeText={(v) => {
          setText(v);
          setSaved(false);
        }}
        placeholder="Your notes on this job"
        multiline
        style={{ minHeight: 160 }}
      />
      <T variant="meta" tone="faint">
        {saved ? 'Saved' : 'Saving…'}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md },
  next: { borderLeftWidth: 3, padding: space.md, marginTop: space.md, borderRadius: radius.base },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.base,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: 4,
    borderRadius: radius.base,
  },
});
