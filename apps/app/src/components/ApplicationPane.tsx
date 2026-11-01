import type { Application, Job, Requirement } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import { Linking, Pressable, Text, View } from 'react-native';
import { applicationUrl } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useStartRun } from '@/lib/hooks';
import { fonts, space, type, useTheme } from '@/theme';
import { Button, Icon, type IconName, Notice, T } from './ui';

/** "just now", "3h ago", or a date for older ones. */
const written = (at: string) => {
  const when = timeAgo(at);
  return /^\d+[mhd]$/.test(when) ? `${when} ago` : when === 'just now' ? when : `on ${when}`;
};

const pages = (n: number | null) => (n == null ? '?' : `${n} page${n === 1 ? '' : 's'}`);

const STATUS: Record<Requirement['status'], { icon: IconName; label: string }> = {
  shown: { icon: 'check', label: 'Shown' },
  bridged: { icon: 'east', label: 'Answered in the letter' },
  gap: { icon: 'close', label: 'Gap' },
};

/** The CV and cover letter written for this job, or the button that writes them. */
export function ApplicationPane({ job }: { job: Job }) {
  const start = useStartRun();
  const busy = !!job.activity;
  const write = () => start.mutate({ kind: 'tailor', jobIds: [job.id] });
  const app = job.application;
  const writing = job.activity?.kind === 'tailor';

  if (!app)
    return (
      <Notice
        icon="description"
        title={writing ? 'Writing your CV and letter…' : 'No CV or letter yet'}
        body="Winnow writes a CV and cover letter for this job from your CV and profile, has a second pass read them as the employer would, revises, and checks the PDFs. Every fact comes from your own files."
        action={
          writing ? null : (
            <View style={{ gap: 6 }}>
              <Button
                label="Write CV and letter"
                icon="edit-note"
                disabled={busy}
                onPress={write}
              />
              <T variant="meta" tone="faint">
                Uses tokens · {RUN_COSTS.tailor.estimate}
              </T>
            </View>
          )
        }
      />
    );

  return <Written job={job} app={app} busy={busy} writing={writing} onWrite={write} />;
}

function Written({
  job,
  app,
  busy,
  writing,
  onWrite,
}: {
  job: Job;
  app: Application;
  busy: boolean;
  writing: boolean;
  onWrite: () => void;
}) {
  const { c } = useTheme();
  const open = (file: 'cv.pdf' | 'cover.pdf' | 'cv.tex' | 'cover.tex') =>
    void Linking.openURL(applicationUrl(job.id, file, app.at));
  const problems = [...app.cv.problems, ...app.cover.problems];
  const reqs = [...app.requirements].sort(
    (a, b) => Number(a.need === 'nice') - Number(b.need === 'nice'),
  );

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button label="CV" icon="picture-as-pdf" onPress={() => open('cv.pdf')} />
        <Button
          kind="secondary"
          label="Cover letter"
          icon="picture-as-pdf"
          onPress={() => open('cover.pdf')}
        />
      </View>
      <T variant="meta" tone="faint">
        CV {pages(app.cv.pages)} · letter {pages(app.cover.pages)} · written {written(app.at)}
      </T>

      {app.summary ? <Text style={[type.reading, { color: c.ink }]}>{app.summary}</Text> : null}

      {problems.length ? (
        <Notice
          tone="warning"
          icon="warning-amber"
          title="Check the PDFs"
          body={problems.join(' ')}
        />
      ) : null}

      {app.stretches.length ? (
        <View style={{ gap: 4 }}>
          <Text style={[type.caps, { color: c.amberText }]}>Check before sending</Text>
          <T variant="meta" tone="lead">
            Lines that only just hold up. Could you explain each in an interview?
          </T>
          {app.stretches.map((s) => (
            <View key={s} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={[type.bodySmall, { color: c.lead }]}>•</Text>
              <Text style={[type.bodySmall, { color: c.ink, flex: 1 }]}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {reqs.length ? (
        <View style={{ gap: 6 }}>
          <Text style={[type.caps, { color: c.lead }]}>What the posting asks for</Text>
          {reqs.map((r) => {
            const s = STATUS[r.status];
            const tone =
              r.status === 'shown'
                ? c.sageText
                : r.status === 'bridged'
                  ? c.amberText
                  : c.dangerText;
            return (
              <View key={r.text} style={{ flexDirection: 'row', gap: 8 }}>
                <Icon name={s.icon} size={16} color={tone} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodySmall, { color: c.ink }]}>
                    {r.text}
                    {r.need === 'nice' ? (
                      <Text style={{ color: c.faint }}> · nice to have</Text>
                    ) : null}
                  </Text>
                  <T variant="meta" tone="lead">
                    {r.status === 'shown'
                      ? r.where || s.label
                      : `${s.label}${r.where ? `: ${r.where}` : ''}`}
                  </T>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {app.verdict ? (
        <View style={{ gap: 4 }}>
          <Text style={[type.caps, { color: c.lead }]}>Read as the employer</Text>
          <Text
            style={[
              type.reading,
              { color: c.ink, fontFamily: fonts.contentItalic, fontSize: 15.5 },
            ]}
          >
            {app.verdict}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'center' }}>
        <T variant="meta" tone="faint">
          LaTeX source:
        </T>
        {(['cv.tex', 'cover.tex'] as const).map((f) => (
          <Pressable key={f} onPress={() => open(f)} accessibilityRole="link">
            <T variant="label" tone="primary">
              {f}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 6, alignItems: 'flex-start' }}>
        <Button
          kind="secondary"
          label={writing ? 'Writing…' : 'Write again'}
          icon="refresh"
          disabled={busy}
          onPress={onWrite}
        />
        <T variant="meta" tone="faint">
          Replaces these files · uses tokens · {RUN_COSTS.tailor.estimate}
        </T>
      </View>
    </View>
  );
}
