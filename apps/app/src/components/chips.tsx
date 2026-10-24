import type { Job, Run } from '@winnow/api';
import { ARCHIVE_REASON_LABELS, STAGE_LABELS, VERDICT_LABELS } from '@winnow/api';
import { ActivityIndicator, Text, View } from 'react-native';
import { fonts, radius, useTheme } from '@/theme';

export type ChipTone = 'sage' | 'amber' | 'danger' | 'primary' | 'neutral';

/** A small status marker: tinted background, coloured words. Never colour alone. */
export function Chip({
  label,
  tone = 'neutral',
  mono,
  busy,
}: {
  label: string;
  tone?: ChipTone;
  mono?: string;
  busy?: boolean;
}) {
  const { c } = useTheme();
  const map = {
    sage: { bg: c.sageSoft, fg: c.sageText },
    amber: { bg: c.amberSoft, fg: c.amberText },
    danger: { bg: c.dangerSoft, fg: c.dangerText },
    primary: { bg: c.primarySoft, fg: c.primaryInk },
    neutral: { bg: c.rule, fg: c.lead },
  }[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: radius.base,
        backgroundColor: map.bg,
        alignSelf: 'flex-start',
      }}
    >
      {busy ? <ActivityIndicator size={10} color={map.fg} /> : null}
      {mono ? (
        <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: map.fg }}>{mono}</Text>
      ) : null}
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12, color: map.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function verdictTone(score: number | null | undefined, verdict?: string): ChipTone {
  if (verdict === 'apply_now' || verdict === 'apply') return 'sage';
  if (verdict === 'maybe') return 'amber';
  if (verdict === 'skip') return 'danger';
  if (score == null) return 'neutral';
  return score >= 4 ? 'sage' : score >= 3 ? 'amber' : 'danger';
}

const ACTIVITY_LABEL: Record<string, string> = {
  score: 'Scoring',
  triage: 'Triaging',
  capture: 'Reading',
};

/** The one chip a job row shows, picked by where the job is and what is happening to it. */
export function JobStatusChip({ job }: { job: Job }) {
  if (job.activity) {
    const waiting = job.activity.status === 'queued';
    return (
      <Chip
        label={waiting ? 'Waiting' : (ACTIVITY_LABEL[job.activity.kind] ?? 'Working')}
        busy={!waiting}
        tone={waiting ? 'neutral' : 'primary'}
      />
    );
  }
  if (job.list === 'applied' && job.stage)
    return <Chip label={STAGE_LABELS[job.stage]} tone="primary" />;
  if (job.list === 'archive' && job.archiveReason) {
    const short =
      job.archiveReason === 'triage'
        ? 'Triage'
        : job.archiveReason === 'rules'
          ? 'Rule'
          : ARCHIVE_REASON_LABELS[job.archiveReason];
    return <Chip label={short} tone="neutral" />;
  }
  if (job.score) return <ScoreChip score={job.score.score} verdict={job.score.verdict} />;
  if (job.triage) {
    if (job.triage.verdict === 'keep') return <Chip label="Kept" tone="sage" />;
    if (job.triage.verdict === 'unsure') return <Chip label="Unsure" tone="amber" />;
  }
  return null;
}

export function ScoreChip({
  score,
  verdict,
}: {
  score: number;
  verdict: keyof typeof VERDICT_LABELS;
}) {
  return (
    <Chip
      mono={score.toFixed(1)}
      label={VERDICT_LABELS[verdict]}
      tone={verdictTone(score, verdict)}
    />
  );
}

export function runTone(run: Run): ChipTone {
  switch (run.status) {
    case 'succeeded':
      return 'sage';
    case 'failed':
      return 'danger';
    case 'interrupted':
    case 'needs_input':
      return 'amber';
    case 'running':
      return 'primary';
    default:
      return 'neutral';
  }
}

export const RUN_STATUS_LABEL: Record<Run['status'], string> = {
  queued: 'Waiting',
  running: 'Running',
  needs_input: 'Needs you',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};
