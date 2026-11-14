import type { ChecklistItem, JobDetail, OppLink, TrackStatus } from '@winnow/api';
import { RUN_COSTS, SHAPE_HINTS, SHAPE_LABELS, TRACK_LABELS, TRACK_STATUSES } from '@winnow/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useStartRun } from '@/lib/hooks';
import { refreshJobs } from '@/lib/query';
import { dueLabel, fundingLabel, fundingTone } from '@/lib/study';
import { toast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';
import { Chip, ScoreChip } from './chips';
import { Input } from './inputs';
import { Markdown } from './Markdown';
import { Button, Icon, Notice, SectionTitle, T } from './ui';

/** Funding level as a chip, coloured by how much it covers. */
export function FundingChip({ job }: { job: { opportunity: JobDetail['opportunity'] } }) {
  const f = job.opportunity?.funding;
  if (!f || f === 'unknown') return null;
  return <Chip label={fundingLabel(f)} tone={fundingTone(f)} />;
}

/** Eligibility as a chip: only when it isn't plainly fine, or when there are things to do. */
export function EligibilityChip({ job }: { job: { opportunity: JobDetail['opportunity'] } }) {
  const e = job.opportunity?.eligibility;
  if (!e) return null;
  if (e.status === 'ineligible') return <Chip label="Not eligible" tone="danger" />;
  if (e.todos.length) return <Chip label={`${e.todos.length} to do`} tone="amber" />;
  if (e.status === 'unclear') return <Chip label="Check eligibility" tone="amber" />;
  return null;
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  const { c } = useTheme();
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Text style={[type.meta, { color: c.lead, width: 104 }]}>{label}</Text>
      <Text style={[type.bodySmall, { color: c.ink, flex: 1 }]}>{value}</Text>
    </View>
  );
}

const date = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

/** What the page says: funding, deadlines, who can apply, what to send. */
export function OppFacts({ job }: { job: JobDetail }) {
  const { c } = useTheme();
  const o = job.opportunity;
  if (!o) return null;
  const e = o.eligibility;
  const due = dueLabel(job);
  return (
    <View style={[styles.card, { backgroundColor: c.surface, gap: 8 }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <FundingChip job={job} />
        {o.shape ? <Chip label={SHAPE_LABELS[o.shape]} /> : null}
        {o.round === 'closed' ? <Chip label="Between rounds" tone="amber" /> : null}
        {o.round === 'upcoming' ? <Chip label="Opens soon" tone="primary" /> : null}
        {due ? (
          <Chip label={due.label} tone={due.soon ? 'danger' : due.past ? 'neutral' : 'primary'} />
        ) : null}
      </View>
      {o.shape ? (
        <T variant="meta" tone="lead">
          {SHAPE_HINTS[o.shape]}
        </T>
      ) : null}
      <Fact label={job.kind === 'programme' ? 'Costs' : 'Pays'} value={o.covers || o.tuition} />
      {job.kind === 'programme' && o.covers && o.tuition ? (
        <Fact label="Tuition" value={o.tuition} />
      ) : null}
      <Fact label="Where" value={o.countries.join(', ')} />
      <Fact label="University" value={o.university} />
      <Fact label="Subject" value={o.subject} />
      <Fact label="Level" value={o.level} />
      <Fact label="Length" value={o.length} />
      <Fact label="Intake" value={o.intake} />
      <Fact label="Scholarship due" value={date(o.deadlines.scholarship)} />
      <Fact label="Admission due" value={date(o.deadlines.admission)} />
      {e ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          <Text
            style={[
              type.caps,
              {
                color:
                  e.status === 'eligible'
                    ? c.sageText
                    : e.status === 'ineligible'
                      ? c.dangerText
                      : c.amberText,
              },
            ]}
          >
            {e.status === 'eligible'
              ? 'You can apply'
              : e.status === 'ineligible'
                ? 'You can’t apply'
                : 'Eligibility unclear'}
          </Text>
          {e.who ? (
            <T variant="bodySmall" tone="lead">
              {e.who}
            </T>
          ) : null}
          {e.fails.map((f) => (
            <T key={f} variant="bodySmall" tone="danger">
              ✕ {f}
            </T>
          ))}
          {e.todos.map((t) => (
            <T key={t} variant="bodySmall">
              ☐ {t}
            </T>
          ))}
        </View>
      ) : null}
      {o.schools.length ? <Fact label="Schools" value={o.schools.slice(0, 12).join(', ')} /> : null}
      {o.documents.length ? <Fact label="Send" value={o.documents.join(', ')} /> : null}
      {o.essays.length ? <Fact label="Essays" value={o.essays.join(' · ')} /> : null}
      {o.officialUrl ? (
        <Pressable
          onPress={() => void Linking.openURL(o.officialUrl as string)}
          accessibilityRole="link"
        >
          <T variant="label" tone="primary">
            Provider’s own page ↗
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

const RELATION: Record<OppLink['relation'], string> = {
  covers: 'Covers it',
  built_in: 'Built in',
  eligible: 'May cover it',
};

function LinkRow({ link, onRemove }: { link: OppLink; onRemove: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.link, { borderBottomColor: c.rule }]}>
      <Pressable
        style={{ flex: 1, gap: 2 }}
        onPress={() => router.push(`/job/${link.id}` as never)}
        accessibilityRole="button"
      >
        <T variant="label" numberOfLines={2}>
          {link.title}
        </T>
        <T variant="meta" tone="lead" numberOfLines={1}>
          {[link.org, RELATION[link.relation], link.list === 'archive' ? 'Archived' : null]
            .filter(Boolean)
            .join(' · ')}
        </T>
      </Pressable>
      {link.funding && link.funding !== 'unknown' ? (
        <Chip label={fundingLabel(link.funding)} tone={fundingTone(link.funding)} />
      ) : null}
      {link.score != null ? (
        <ScoreChip
          score={link.score}
          verdict={link.score >= 4 ? 'apply' : link.score >= 3 ? 'maybe' : 'skip'}
        />
      ) : null}
      <Pressable onPress={onRemove} accessibilityLabel={`Unlink ${link.title}`} hitSlop={8}>
        <Icon name="link-off" size={18} tone="faint" />
      </Pressable>
    </View>
  );
}

/**
 * A scholarship's programmes, or a programme's ways to pay. Links come from the facts (a scheme naming
 * the university) and from Find programmes / Find funding.
 */
export function OppLinks({ job }: { job: JobDetail }) {
  const start = useStartRun();
  const sch = job.kind === 'scholarship';
  const shown = job.links.filter((l) => l.kind === (sch ? 'programme' : 'scholarship'));
  const busy = !!job.activity;
  const run = sch ? 'match_programmes' : 'find_funding';
  const unlink = (other: string) =>
    void api.unlink(job.id, other).then(refreshJobs, (e) => toast.show((e as Error).message));
  const builtIn = !sch && job.opportunity?.shape === 'built_in';
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>{sch ? 'Programmes it covers' : 'Ways to pay'}</SectionTitle>
      {builtIn ? (
        <T variant="bodySmall" tone="lead">
          Funding is part of this programme: one application covers both.
        </T>
      ) : null}
      {!sch && job.opportunity?.funding === 'tuition_free' ? (
        <T variant="bodySmall" tone="lead">
          No tuition for you here. Scholarships below would help with living costs.
        </T>
      ) : null}
      {shown.length ? (
        <View>
          {shown.map((l) => (
            <LinkRow key={l.id} link={l} onRemove={() => unlink(l.id)} />
          ))}
        </View>
      ) : (
        <T variant="bodySmall" tone="lead">
          {sch
            ? 'No programmes linked yet. Find the ones it pays for that fit you.'
            : 'No scholarships linked yet. Find the ones that would pay for this.'}
        </T>
      )}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          kind="secondary"
          icon={sch ? 'school' : 'payments'}
          label={sch ? 'Find programmes' : 'Find funding'}
          disabled={busy}
          onPress={() => start.mutate({ kind: run, jobIds: [job.id] })}
        />
        <T variant="meta" tone="faint">
          Uses tokens · {RUN_COSTS[run].estimate}
        </T>
      </View>
    </View>
  );
}

/** Where each application stands, and what to gather. */
export function OppPlanView({ job }: { job: JobDetail }) {
  const { c } = useTheme();
  const [adding, setAdding] = useState('');
  const plan = job.plan;
  const save = (patch: Parameters<typeof api.savePlan>[1]) =>
    void api.savePlan(job.id, patch).then(refreshJobs, (e) => toast.show((e as Error).message));
  const funding = job.links.filter((l) => l.kind === 'scholarship');
  if (!plan)
    return (
      <Notice
        title="No plan yet"
        body="Start one to track each application and the documents to gather."
        action={<Button label="Start a plan" icon="checklist" onPress={() => save({})} />}
      />
    );
  const setItems = (checklist: ChecklistItem[]) => save({ checklist });
  return (
    <View style={{ gap: space.md }}>
      {job.kind === 'programme' && funding.length ? (
        <View style={{ gap: 6 }}>
          <SectionTitle>Funding to apply for with it</SectionTitle>
          {funding.map((l) => {
            const on = plan.fundingIds.includes(l.id);
            return (
              <Pressable
                key={l.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  save({
                    fundingIds: on
                      ? plan.fundingIds.filter((f) => f !== l.id)
                      : [...plan.fundingIds, l.id],
                  })
                }
                style={{ flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 40 }}
              >
                <Icon
                  name={on ? 'check-box' : 'check-box-outline-blank'}
                  tone={on ? 'primary' : 'faint'}
                />
                <T variant="bodySmall" style={{ flex: 1 }}>
                  {l.title}
                </T>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <SectionTitle>Applications</SectionTitle>
        {plan.tracks.map((t) => (
          <View key={t.key} style={[styles.card, { backgroundColor: c.surface, gap: 6 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T variant="label" style={{ flex: 1 }}>
                {t.label}
              </T>
              <T variant="meta" tone="lead">
                {date(t.deadline) ?? 'No date'}
              </T>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TRACK_STATUSES.map((s: TrackStatus) => (
                <Pressable
                  key={s}
                  onPress={() => t.status !== s && save({ tracks: [{ key: t.key, status: s }] })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: t.status === s }}
                  style={[
                    styles.pill,
                    {
                      borderColor: t.status === s ? c.ink : c.ruleStrong,
                      backgroundColor: t.status === s ? c.ink : 'transparent',
                    },
                  ]}
                >
                  <Text style={[type.meta, { color: t.status === s ? c.canvas : c.ink }]}>
                    {TRACK_LABELS[s]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </View>
      <View style={{ gap: 2 }}>
        <SectionTitle>Checklist</SectionTitle>
        {plan.checklist.map((i) => (
          <View
            key={i.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: i.done }}
              onPress={() =>
                setItems(plan.checklist.map((x) => (x.key === i.key ? { ...x, done: !x.done } : x)))
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
            >
              <Icon
                name={i.done ? 'check-box' : 'check-box-outline-blank'}
                tone={i.done ? 'sage' : 'faint'}
              />
              <T
                variant="bodySmall"
                tone={i.done ? 'lead' : 'ink'}
                style={i.done ? { textDecorationLine: 'line-through' } : undefined}
              >
                {i.label}
              </T>
            </Pressable>
            <Pressable
              onPress={() => setItems(plan.checklist.filter((x) => x.key !== i.key))}
              accessibilityLabel={`Remove ${i.label}`}
              hitSlop={8}
            >
              <Icon name="close" size={16} tone="faint" />
            </Pressable>
          </View>
        ))}
        <Input
          value={adding}
          onChangeText={setAdding}
          placeholder="Add an item and press Enter"
          returnKeyType="done"
          onSubmitEditing={() => {
            const label = adding.trim();
            if (!label) return;
            setItems([...plan.checklist, { key: '', label, done: false }]);
            setAdding('');
          }}
        />
      </View>
    </View>
  );
}

/** Drafted essays, with a way to draft them (again). */
export function EssaysView({ job }: { job: JobDetail }) {
  const start = useStartRun();
  const busy = !!job.activity;
  return (
    <View style={{ gap: space.md }}>
      {job.essays ? (
        <Markdown text={job.essays} />
      ) : (
        <Notice
          title="No essays yet"
          body={
            job.opportunity?.essays.length
              ? `This application asks for: ${job.opportunity.essays.join('; ')}.`
              : 'Winnow drafts what the page asks for, or a motivation statement when it asks for none.'
          }
        />
      )}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Button
          kind={job.essays ? 'secondary' : 'primary'}
          icon="edit-note"
          label={job.essays ? 'Draft again' : 'Draft essays'}
          disabled={busy}
          onPress={() => start.mutate({ kind: 'essays', jobIds: [job.id] })}
        />
        <T variant="meta" tone="faint">
          Uses tokens · {RUN_COSTS.essays.estimate}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.base,
    borderWidth: 1,
  },
});
