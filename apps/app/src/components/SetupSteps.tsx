import type {
  Mode,
  RoleFit,
  SetupAbout,
  SetupAnswer,
  SetupDraft,
  SetupRole,
  SetupState,
  SetupStep,
  SetupWant,
  SourceEntry,
  StudyPrefs,
  WorkType,
} from '@winnow/api';
import {
  EMPTY_STUDY,
  MODE_LABELS,
  questionsFor,
  ROLE_FIT_LABELS,
  WORK_TYPE_LABELS,
} from '@winnow/api';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '@/lib/api';
import { pickPdf } from '@/lib/files';
import { useMe, useProfile, useRun } from '@/lib/hooks';
import { applyRun, keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space, useTheme } from '@/theme';
import { Check, Input, Segmented } from './inputs';
import { Markdown } from './Markdown';
import { StudyForm } from './StudyForm';
import { ChipInput, SetupField, SetupRun, ToggleChip } from './setup';
import { Button, IconButton, Loading, Notice, T } from './ui';

export interface StepProps {
  s: SetupState;
  /** Save what this step collected and move to another step. */
  go: (next: SetupStep, patch?: Record<string, unknown>) => Promise<void>;
  /** Put the server's answer in the cache. */
  set: (s: SetupState) => void;
}

const ACTIVE = new Set(['queued', 'running', 'needs_input']);

function Title({ children, lead }: { children: string; lead?: string }) {
  return (
    <View style={{ gap: space.xs, marginTop: space.lg, marginBottom: space.md }}>
      <T variant="headline">{children}</T>
      {lead ? (
        <T variant="body" tone="lead">
          {lead}
        </T>
      ) : null}
    </View>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: space.sm,
        marginTop: space.lg,
      }}
    >
      {children}
    </View>
  );
}

const fail = (e: unknown) => toast.show((e as Error).message);

// ── Start ───────────────────────────────────────────────────────────────────

export function StartStep({ s, go, onLater }: StepProps & { onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await go('cv');
    } finally {
      setBusy(false);
    }
  };
  const study = s.mode === 'scholarships';
  const [mode, setMode] = useState<Mode>(s.mode);
  const pickMode = async (m: Mode) => {
    setMode(m);
    try {
      await api.setMode(m);
      void queryClient.invalidateQueries({ queryKey: keys.me });
      void queryClient.invalidateQueries({ queryKey: keys.setup });
    } catch (e) {
      setMode(s.mode);
      fail(e);
    }
  };
  const items = study
    ? [
        ['Your CV', 'A PDF, or pasted text, plus a statement or letter in your own words'],
        ['About you', 'Contact details'],
        ['What you want to study', 'Subjects, places, nationality, English, funding'],
        ['Get to know you', 'Five questions scholarship panels ask'],
        ['Review', 'The profile AI drafts from all of it'],
        ['Sources', 'Scheme and university pages, feeds and searches to watch'],
      ]
    : [
        ['Your CV', 'A PDF, or pasted text'],
        ['About you', 'Contact details and where you can work'],
        ['What you want', 'Roles, places, pay and deal-breakers'],
        ['Get to know you', 'Five questions a CV can’t answer'],
        ['Review', 'The profile AI drafts from all of it'],
        ['Sources', 'Where your jobs will come from'],
      ];
  return (
    <View>
      <Title
        lead={
          s.redo
            ? 'We start from your current profile. Nothing changes until you confirm it on Review, and your old files are kept as backups.'
            : study
              ? 'Winnow finds scholarships and master’s programmes, and judges each one against your CV and profile. This sets them up, in about 10 minutes.'
              : 'Winnow judges every job against your CV and profile. This sets them up, in about 10 minutes.'
        }
      >
        {s.redo ? 'Set up again' : 'Let’s set up Winnow'}
      </Title>
      {s.redo ? null : (
        <View style={{ gap: 6, marginBottom: space.md }}>
          <T variant="caps" tone="lead">
            You’re looking for
          </T>
          <Segmented
            value={mode}
            onChange={(m) => void pickMode(m)}
            options={(['jobs', 'scholarships'] as Mode[]).map((m) => ({
              value: m,
              label: MODE_LABELS[m],
            }))}
          />
        </View>
      )}
      <View style={{ gap: space.sm }}>
        {items.map(([title, note], i) => (
          <View key={title} style={{ flexDirection: 'row', gap: space.md, alignItems: 'baseline' }}>
            <T variant="mono" tone="faint" style={{ width: 16 }}>
              {i + 1}
            </T>
            <View style={{ flex: 1 }}>
              <T variant="label">{title}</T>
              <T variant="meta" tone="lead">
                {note}
              </T>
            </View>
          </View>
        ))}
      </View>
      <Notice
        tone="info"
        icon="auto-awesome"
        title="AI reads what you give it"
        body="It fills in the forms from your CV and drafts your profile. Nothing is saved as your profile until you confirm it. Each step uses some tokens."
      />
      <Actions>
        <Button kind="ghost" label="Finish later" onPress={onLater} />
        <Button label="Start" busy={busy} onPress={() => void start()} />
      </Actions>
    </View>
  );
}

// ── CV ──────────────────────────────────────────────────────────────────────

export function CvStep({ s, go, set }: StepProps) {
  const profile = useProfile().data;
  const run = useRun(s.runs.cv ?? '').data?.run;
  const reading = !!run && ACTIVE.has(run.status);
  const words = profile?.cv.trim() ? profile.cv.split(/\s+/).length : 0;
  const [pasting, setPasting] = useState(Platform.OS !== 'web');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'text' | null>(null);

  const started = async (runs: Awaited<ReturnType<typeof api.pasteCv>>) => {
    for (const r of runs) applyRun(r);
    set(await api.setup());
    await go('about');
  };
  const upload = async () => {
    const file = await pickPdf();
    if (!file) return;
    setBusy('pdf');
    try {
      await started(await api.uploadCvPdf(file, file.name));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const paste = async () => {
    setBusy('text');
    try {
      await started(await api.pasteCv(text));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <Title lead="AI turns it into a clean copy for scoring, keeping every fact and adding none, and fills in the next steps from it.">
        Your CV
      </Title>
      <SetupRun id={s.runs.cv} label="Reading your CV" />
      {reading ? (
        <Notice
          tone="neutral"
          title="You can carry on while it reads"
          body="The next steps fill in from it as soon as it’s done."
        />
      ) : words > 0 ? (
        <Notice
          tone="neutral"
          icon="description"
          title={`You have a CV (${words.toLocaleString()} words)`}
          body="Keep it and continue, or upload a newer one."
        />
      ) : null}
      {Platform.OS === 'web' ? (
        <View style={{ flexDirection: 'row', marginTop: space.sm }}>
          <Button
            kind={words || reading ? 'secondary' : 'primary'}
            icon="upload-file"
            label={words || reading ? 'Upload a different PDF' : 'Upload a PDF'}
            busy={busy === 'pdf'}
            onPress={() => void upload()}
          />
        </View>
      ) : null}
      {pasting ? (
        <View style={{ marginTop: space.md }}>
          <SetupField label="Or paste your CV" hint="All of it, as plain text.">
            <Input area value={text} onChangeText={setText} style={{ minHeight: 200 }} />
          </SetupField>
          <View style={{ flexDirection: 'row' }}>
            <Button
              kind="secondary"
              label="Use this text"
              busy={busy === 'text'}
              disabled={text.trim().length < 200}
              hint={text.trim() && text.trim().length < 200 ? 'That’s too short for a CV.' : null}
              onPress={() => void paste()}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', marginTop: space.xs }}>
          <Button kind="ghost" label="Paste it instead" onPress={() => setPasting(true)} />
        </View>
      )}
      <T variant="meta" tone="faint" style={{ marginTop: space.md }}>
        Scanned PDFs (photos of pages) can’t be read. Export it from Word or Google Docs instead.
      </T>
      {s.mode === 'scholarships' ? <StatementPart /> : null}
      <Actions>
        <Button
          label="Continue"
          disabled={!words && !reading}
          hint={!words && !reading ? 'Add your CV to continue.' : null}
          onPress={() => void go('about')}
        />
      </Actions>
    </View>
  );
}

/** Scholarships: a personal statement or cover letter, kept as written. Optional. */
function StatementPart() {
  const profile = useProfile().data;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'text' | null>(null);
  const words = profile?.statement?.trim() ? profile.statement.split(/\s+/).length : 0;
  const saved = (p: unknown) => {
    queryClient.setQueryData(keys.profile, p);
    toast.show('Saved your document');
  };
  const upload = async () => {
    const file = await pickPdf();
    if (!file) return;
    setBusy('pdf');
    try {
      saved(await api.uploadStatementPdf(file, file.name));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ marginTop: space.lg, gap: space.sm }}>
      <T variant="title">In your own words (optional)</T>
      <T variant="body" tone="lead">
        A personal statement, motivation letter or cover letter you’ve written. AI reads it for
        facts the CV leaves out, and keeps your voice in essays and letters.
      </T>
      {words ? (
        <Notice
          tone="neutral"
          icon="description"
          title={`Saved (${words.toLocaleString()} words)`}
          body="Upload or paste again to replace it."
        />
      ) : null}
      {Platform.OS === 'web' ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            kind="secondary"
            icon="upload-file"
            label="Upload a PDF"
            busy={busy === 'pdf'}
            onPress={() => void upload()}
          />
        </View>
      ) : null}
      <Input
        area
        value={text}
        onChangeText={setText}
        placeholder="Or paste it here"
        style={{ minHeight: 120 }}
      />
      <View style={{ flexDirection: 'row' }}>
        <Button
          kind="secondary"
          label="Save this text"
          busy={busy === 'text'}
          disabled={text.trim().length < 100}
          onPress={() => {
            setBusy('text');
            void api
              .pasteStatement(text)
              .then((p) => {
                saved(p);
                setText('');
              }, fail)
              .finally(() => setBusy(null));
          }}
        />
      </View>
    </View>
  );
}

// ── About you ───────────────────────────────────────────────────────────────

const ABOUT: { key: keyof SetupAbout; label: string; hint?: string; placeholder?: string }[] = [
  { key: 'name', label: 'Full name' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
  { key: 'timezone', label: 'Time zone' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://www.linkedin.com/in/…' },
  { key: 'portfolio', label: 'Portfolio or website' },
  {
    key: 'workRight',
    label: 'Right to work',
    hint: 'Where you can work without sponsorship, or the visa you hold.',
    placeholder: 'For example: UK citizen, no sponsorship needed',
  },
  {
    key: 'languages',
    label: 'Languages you speak',
    hint: 'With your level. Triage drops jobs that need a language you don’t list.',
    placeholder: 'For example: English (native), French (B1)',
  },
];

/**
 * A form that fills in from AI's pre-fill as soon as it arrives, without touching what the person
 * typed. `fromCv(key)` says whether a field still shows the CV's value.
 */
function usePrefilled<K extends string>(
  saved: Partial<Record<K, unknown>>,
  prefill: Partial<Record<K, unknown>> | null,
  keys: K[],
  defaults: Partial<Record<K, unknown>> = {},
) {
  const pick = (k: K) => saved[k] ?? prefill?.[k] ?? defaults[k];
  const [form, setForm] = useState(
    () => Object.fromEntries(keys.map((k) => [k, pick(k)])) as Record<K, unknown>,
  );
  const touched = useRef(new Set<K>(Object.keys(saved) as K[]));
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => {
      const next = { ...f };
      for (const k of keys) {
        const empty =
          f[k] == null || f[k] === '' || (Array.isArray(f[k]) && !(f[k] as unknown[]).length);
        if (!touched.current.has(k) && empty && prefill[k] != null) next[k] = prefill[k];
      }
      return next;
    });
  }, [prefill]);
  const change = (k: K, v: unknown) => {
    touched.current.add(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const fromCv = (k: K) => {
    const p = prefill?.[k];
    const blank = p == null || p === '' || (Array.isArray(p) && !p.length);
    return !touched.current.has(k) && !blank && JSON.stringify(form[k]) === JSON.stringify(p);
  };
  return { form, change, fromCv };
}

export function AboutStep({ s, go }: StepProps) {
  const me = useMe().data;
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  })();
  const fields =
    s.mode === 'scholarships'
      ? ABOUT.filter((f) => f.key !== 'timezone' && f.key !== 'workRight')
      : ABOUT;
  const { form, change, fromCv } = usePrefilled<keyof SetupAbout>(
    s.about,
    s.prefill?.about ?? null,
    fields.map((f) => f.key),
    s.mode === 'scholarships' ? {} : { timezone: tz },
  );
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    try {
      await go('want', { about: form });
    } finally {
      setBusy(false);
    }
  };
  const name = String(form.name ?? '').trim();
  return (
    <View>
      <Title
        lead={
          s.mode === 'scholarships'
            ? 'Used on applications, essays and letters.'
            : 'Used on applications and to judge where you can work.'
        }
      >
        About you
      </Title>
      <SetupRun id={s.runs.cv} label="Reading your CV" />
      <SetupRun id={s.runs.prefill} label="Filling these in from your CV" />
      {fields.map((f) => (
        <SetupField key={f.key} label={f.label} hint={f.hint} fromCv={fromCv(f.key)}>
          <Input
            value={String(form[f.key] ?? '')}
            onChangeText={(v) => change(f.key, v)}
            placeholder={f.placeholder}
            autoCapitalize={f.key === 'linkedin' || f.key === 'portfolio' ? 'none' : undefined}
          />
        </SetupField>
      ))}
      <SetupField label="Email" hint="From your account.">
        <T variant="body">{me?.email ?? ''}</T>
      </SetupField>
      <Actions>
        <Button
          label="Continue"
          busy={busy}
          disabled={!name}
          hint={!name ? 'Add your name to continue.' : null}
          onPress={() => void next()}
        />
      </Actions>
    </View>
  );
}

// ── What you want ───────────────────────────────────────────────────────────

const DEAL_BREAKERS = [
  'Unpaid or volunteer',
  'Commission-only pay',
  'Fixed-term contract',
  'Shift or weekend work',
  'Needs a car',
  'Travel over 25%',
  'Relocation',
];

type WantKey = keyof SetupWant;
const WANT_KEYS: WantKey[] = [
  'roles',
  'level',
  'workTypes',
  'places',
  'currency',
  'salaryTarget',
  'salaryMin',
  'dealBreakers',
];

export function WantStep(props: StepProps) {
  return props.s.mode === 'scholarships' ? (
    <StudyWantStep {...props} />
  ) : (
    <JobWantStep {...props} />
  );
}

/** Scholarships: what to study, where, and the facts schemes judge on. */
function StudyWantStep({ s, go }: StepProps) {
  const pre = s.prefill;
  const initial = (): StudyPrefs => ({
    ...EMPTY_STUDY,
    ...(s.want.study ?? {}),
    places: { ...EMPTY_STUDY.places, ...(s.want.study?.places ?? {}) },
    subjects: s.want.roles ?? [],
    nationality: s.about.nationality ?? pre?.about?.nationality ?? '',
  });
  const [study, setStudy] = useState<StudyPrefs>(initial);
  const touched = useRef(false);
  // The pre-fill can land after the step opens: take its nationality if nothing was typed.
  useEffect(() => {
    if (!touched.current && pre?.about?.nationality && !study.nationality)
      setStudy((v) => ({ ...v, nationality: pre.about?.nationality ?? '' }));
  }, [pre]);
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    const { subjects, nationality, ...rest } = study;
    try {
      await go('know', {
        want: { roles: subjects, level: study.level, study: rest },
        about: { ...s.about, nationality },
      });
    } finally {
      setBusy(false);
    }
  };
  const suggested = (pre?.roles ?? []).map((r) => r.title);
  return (
    <View>
      <Title lead="Scans, triage and scoring judge every scholarship and programme against these.">
        What you want to study
      </Title>
      <SetupRun id={s.runs.prefill} label="Suggesting subjects from your CV" />
      <StudyForm
        value={study}
        onChange={(v) => {
          touched.current = true;
          setStudy(v);
        }}
        subjectSuggestions={suggested}
      />
      <Actions>
        <Button
          label="Continue"
          busy={busy}
          disabled={!study.subjects.length}
          hint={!study.subjects.length ? 'Add at least one programme or subject.' : null}
          onPress={() => void next()}
        />
      </Actions>
    </View>
  );
}

function JobWantStep({ s, go }: StepProps) {
  const pre = s.prefill;
  // Suggested roles stay outlined until tapped in, so they aren't in the form's pre-fill.
  const { form, change, fromCv } = usePrefilled<WantKey>(
    s.want,
    pre
      ? { level: pre.level, places: pre.places, workTypes: pre.workTypes, currency: pre.currency }
      : null,
    WANT_KEYS,
    { roles: [], places: [], workTypes: [], dealBreakers: [] },
  );
  const roles = (form.roles as SetupRole[]) ?? [];
  const [newRole, setNewRole] = useState('');
  const [busy, setBusy] = useState(false);
  const has = (t: string) => roles.some((r) => r.title.toLowerCase() === t.toLowerCase());
  const addRole = (role: SetupRole) => {
    if (!role.title.trim() || has(role.title)) return;
    change('roles', [...roles, { ...role, title: role.title.trim() }]);
  };
  const setFit = (title: string, fit: RoleFit) =>
    change(
      'roles',
      roles.map((r) => (r.title === title ? { ...r, fit } : r)),
    );
  const workTypes = (form.workTypes as WorkType[]) ?? [];
  const suggested = (pre?.roles ?? []).filter((r) => !has(r.title));
  const next = async () => {
    setBusy(true);
    try {
      await go('know', { want: form });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Title lead="Triage and scoring judge every job against these, and Find’s rules come from them.">
        What you want
      </Title>
      <SetupRun id={s.runs.prefill} label="Suggesting roles from your CV" />

      <SetupField
        label="Target roles"
        hint="Dream: what you’d jump at. Good fit: what you can do now. Stretch: worth a look."
      >
        <View style={{ gap: space.sm }}>
          {roles.map((r) => (
            <View
              key={r.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                flexWrap: 'wrap',
              }}
            >
              <T variant="label" style={{ flex: 1, minWidth: 140 }}>
                {r.title}
              </T>
              <View style={{ width: 250 }}>
                <Segmented
                  value={r.fit}
                  options={(Object.keys(ROLE_FIT_LABELS) as RoleFit[]).map((f) => ({
                    value: f,
                    label: ROLE_FIT_LABELS[f],
                  }))}
                  onChange={(f) => setFit(r.title, f)}
                />
              </View>
              <IconButton
                name="close"
                label={`Remove ${r.title}`}
                onPress={() =>
                  change(
                    'roles',
                    roles.filter((x) => x.title !== r.title),
                  )
                }
              />
            </View>
          ))}
          {suggested.length ? (
            <View style={{ gap: 6 }}>
              <T variant="meta" tone="lead">
                Suggested from your CV
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {suggested.map((r) => (
                  <ToggleChip
                    key={r.title}
                    label={`${r.title} · ${ROLE_FIT_LABELS[r.fit]}`}
                    on={false}
                    onPress={() => addRole(r)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Input
            value={newRole}
            onChangeText={setNewRole}
            onSubmitEditing={() => {
              addRole({ title: newRole, fit: 'good' });
              setNewRole('');
            }}
            placeholder="Add a role and press Enter"
            blurOnSubmit={false}
          />
        </View>
      </SetupField>

      <SetupField
        label="Level"
        fromCv={fromCv('level')}
        hint="For example: Manager, Senior / Lead."
      >
        <Input value={String(form.level ?? '')} onChangeText={(v) => change('level', v)} />
      </SetupField>

      <SetupField label="Work type" fromCv={fromCv('workTypes')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.keys(WORK_TYPE_LABELS) as WorkType[]).map((w) => {
            const on = workTypes.includes(w);
            return (
              <ToggleChip
                key={w}
                label={WORK_TYPE_LABELS[w]}
                on={on}
                onPress={() =>
                  change('workTypes', on ? workTypes.filter((x) => x !== w) : [...workTypes, w])
                }
              />
            );
          })}
        </View>
      </SetupField>

      <SetupField
        label="Places"
        fromCv={fromCv('places')}
        hint="Cities, regions or countries you’d work in."
      >
        <ChipInput
          values={(form.places as string[]) ?? []}
          onChange={(v) => change('places', v)}
          placeholder="Add a place and press Enter"
        />
      </SetupField>

      <View style={{ maxWidth: 200 }}>
        <SetupField label="Currency" fromCv={fromCv('currency')}>
          <Input
            value={String(form.currency ?? '')}
            onChangeText={(v) => change('currency', v.toUpperCase())}
            placeholder="GBP"
            autoCapitalize="characters"
          />
        </SetupField>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <SetupField label="Target pay">
            <Input
              value={String(form.salaryTarget ?? '')}
              onChangeText={(v) => change('salaryTarget', v)}
              placeholder="£45K–55K"
            />
          </SetupField>
        </View>
        <View style={{ flex: 1 }}>
          <SetupField label="Walk-away minimum">
            <Input
              value={String(form.salaryMin ?? '')}
              onChangeText={(v) => change('salaryMin', v)}
              placeholder="£40K"
            />
          </SetupField>
        </View>
      </View>

      <SetupField label="Deal-breakers" hint="Jobs with any of these are never for you.">
        <ChipInput
          values={(form.dealBreakers as string[]) ?? []}
          onChange={(v) => change('dealBreakers', v)}
          suggestions={DEAL_BREAKERS}
          placeholder="Add your own and press Enter"
        />
      </SetupField>

      <Actions>
        <Button
          label="Continue"
          busy={busy}
          disabled={!roles.length}
          hint={!roles.length ? 'Add at least one target role.' : null}
          onPress={() => void next()}
        />
      </Actions>
    </View>
  );
}

// ── Get to know you ─────────────────────────────────────────────────────────

type Local = Record<string, { answer: string; followUpAnswer: string }>;

export function KnowStep({ s, go, set }: StepProps) {
  const [i, setI] = useState(0);
  const [local, setLocal] = useState<Local>(() =>
    Object.fromEntries(
      s.answers.map((a) => [a.key, { answer: a.answer, followUpAnswer: a.followUpAnswer }]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const questions = questionsFor(s.mode);
  const n = questions.length;
  const q = questions[Math.min(i, n - 1)];
  const value = (k: string) => local[k] ?? { answer: '', followUpAnswer: '' };
  const edit = (k: string, patch: Partial<Local[string]>) =>
    setLocal((l) => ({ ...l, [k]: { ...value(k), ...patch } }));
  const body = () =>
    Object.entries(local).map(([key, v]) => ({
      key,
      answer: v.answer,
      followUpAnswer: v.followUpAnswer,
    }));

  // Each answer gets its follow-up in the background, so nobody waits between cards.
  const nextCard = async () => {
    if (!q) return;
    setBusy(true);
    try {
      let state = await api.saveSetup({ answers: body() });
      if (value(q.key).answer.trim() && q.key !== 'links') state = await api.followUp(q.key);
      set(state);
      if (i < n - 1) setI(i + 1);
      else if (state.answers.some((a) => a.followUpRun)) setI(n);
      else await go('review', { answers: body() });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (i >= n)
    return (
      <FollowUps
        s={s}
        local={local}
        edit={edit}
        onBack={() => setI(n - 1)}
        onDone={() => go('review', { answers: body() })}
      />
    );
  if (!q) return null;
  return (
    <View>
      <Title lead="What a CV can’t say. Short answers are fine, and you can skip any.">
        Get to know you
      </Title>
      <View style={{ gap: space.sm }}>
        <T variant="caps" tone="lead">
          Question {i + 1} of {n}
        </T>
        <T variant="title">{q.text}</T>
        <T variant="meta" tone="lead">
          {q.hint}
        </T>
        <Input
          area
          value={value(q.key).answer}
          onChangeText={(answer) => edit(q.key, { answer })}
          style={{ minHeight: 140 }}
          autoFocus={Platform.OS === 'web'}
        />
      </View>
      <Actions>
        {i > 0 ? <Button kind="ghost" label="Previous" onPress={() => setI(i - 1)} /> : null}
        <View style={{ flex: 1 }} />
        {!value(q.key).answer.trim() ? (
          <Button kind="secondary" label="Skip" busy={busy} onPress={() => void nextCard()} />
        ) : (
          <Button label={i < n - 1 ? 'Next' : 'Done'} busy={busy} onPress={() => void nextCard()} />
        )}
      </Actions>
    </View>
  );
}

function FollowUp({
  a,
  value,
  onChange,
}: {
  a: SetupAnswer;
  value: string;
  onChange: (v: string) => void;
}) {
  const { c } = useTheme();
  const run = useRun(a.followUpRun ?? '').data?.run;
  const thinking = !a.followUp && !!run && ACTIVE.has(run.status);
  const q = [...questionsFor('jobs'), ...questionsFor('scholarships')].find((x) => x.key === a.key);
  if (!a.followUp && !thinking) return null;
  return (
    <View
      style={{
        gap: space.sm,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: c.rule,
      }}
    >
      <T variant="meta" tone="lead">
        {q?.text}
      </T>
      <T variant="bodySmall" tone="lead" numberOfLines={3} style={{ fontStyle: 'italic' }}>
        “{a.answer}”
      </T>
      {thinking ? (
        <SetupRun id={a.followUpRun} label="Thinking about your answer" />
      ) : (
        <>
          <T variant="label">{a.followUp}</T>
          <Input area value={value} onChangeText={onChange} placeholder="Optional" />
        </>
      )}
    </View>
  );
}

function FollowUps({
  s,
  local,
  edit,
  onBack,
  onDone,
}: {
  s: SetupState;
  local: Local;
  edit: (k: string, patch: { followUpAnswer: string }) => void;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const asked = s.answers.filter((a) => a.followUp);
  const pending = s.answers.filter((a) => a.followUpRun && !a.followUp);
  return (
    <View>
      <Title lead="AI asks one more thing where an answer could say more. Answer any you like.">
        A few follow-ups
      </Title>
      {s.answers.map((a) => (
        <FollowUp
          key={a.key}
          a={a}
          value={local[a.key]?.followUpAnswer ?? ''}
          onChange={(followUpAnswer) => edit(a.key, { followUpAnswer })}
        />
      ))}
      {!asked.length && !pending.length ? (
        <Notice tone="neutral" title="Nothing to add" body="Your answers were clear enough." />
      ) : null}
      <Actions>
        <Button kind="ghost" label="Previous" onPress={onBack} />
        <View style={{ flex: 1 }} />
        <Button
          label="Continue"
          busy={busy}
          onPress={() => {
            setBusy(true);
            void onDone().finally(() => setBusy(false));
          }}
        />
      </Actions>
    </View>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

function Part({
  title,
  editing,
  onEdit,
  editLabel = 'Edit',
  children,
}: {
  title: string;
  editing?: boolean;
  onEdit: () => void;
  editLabel?: string;
  children: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: c.rule,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T variant="caps" tone="lead" style={{ flex: 1 }}>
          {title}
        </T>
        <Button kind="ghost" label={editing ? 'Done' : editLabel} onPress={onEdit} />
      </View>
      {children}
    </View>
  );
}

const lines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function ReviewStep({ s, go, set }: StepProps) {
  const study = s.mode === 'scholarships';
  const [draft, setDraft] = useState<SetupDraft | null>(s.draft);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // A new draft replaces the one on screen.
  useEffect(() => setDraft(s.draft), [s.draft]);

  // Opening Review writes the first draft.
  const asked = useRef(false);
  useEffect(() => {
    if (s.draft || s.runs.draft || asked.current) return;
    asked.current = true;
    api.draftProfile().then(set, fail);
  }, [s.draft, s.runs.draft, set]);

  const rewrite = () => api.draftProfile().then(set, fail);

  if (!draft)
    return (
      <View>
        <Title lead="AI writes it from your CV and answers. It takes about a minute.">
          Your profile
        </Title>
        {s.runs.draft ? (
          <SetupRun id={s.runs.draft} label="Writing your profile" onRetry={() => void rewrite()} />
        ) : (
          <Loading label="Starting" />
        )}
      </View>
    );

  const edit = (key: string, start: string) => {
    if (editing === key) {
      // Done: fold the text back into the draft and keep it on the server.
      const next = { ...draft };
      if (key === 'headline') next.headline = text.trim();
      if (key === 'story') next.story = text.trim();
      if (key === 'superpowers') next.superpowers = lines(text);
      if (key === 'proof')
        next.proofPoints = lines(text).map((l) => {
          const [name, ...rest] = l.split(/\s+[—–-]\s+/);
          return { name: (name ?? '').trim(), metric: rest.join(' – ').trim() };
        });
      if (key === 'narrative') next.narrative = text.trim();
      setDraft(next);
      setEditing(null);
      api.saveSetup({ draft: next }).then(set, fail);
    } else {
      setText(start);
      setEditing(key);
    }
  };
  const w = s.want;
  const confirm = async () => {
    setBusy(true);
    try {
      set(await api.confirmProfile(draft));
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      await go('sources');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const box = (lines = 1) => (
    <Input
      area={lines > 1}
      value={text}
      onChangeText={setText}
      autoFocus
      style={lines > 4 ? { minHeight: 320 } : undefined}
    />
  );
  return (
    <View>
      <Title
        lead={`This is what triage and scoring will judge ${study ? 'scholarships and programmes' : 'jobs'} against. Change anything that isn’t right.`}
      >
        Your profile
      </Title>
      <SetupRun id={s.runs.draft} label="Writing it again" onRetry={() => void rewrite()} />
      <Part
        title="Headline"
        editing={editing === 'headline'}
        onEdit={() => edit('headline', draft.headline)}
      >
        {editing === 'headline' ? box() : <T variant="title">{draft.headline}</T>}
      </Part>
      <Part
        title="Your story"
        editing={editing === 'story'}
        onEdit={() => edit('story', draft.story)}
      >
        {editing === 'story' ? box(3) : <T variant="reading">{draft.story}</T>}
      </Part>
      <Part
        title={study ? 'Subjects' : 'Target roles'}
        onEdit={() => void go('want')}
        editLabel="Change"
      >
        {(w.roles ?? []).map((r) => (
          <View key={r.title}>
            <T variant="label">
              {r.title} · {ROLE_FIT_LABELS[r.fit]}
            </T>
            {draft.roleNotes[r.title] ? (
              <T variant="meta" tone="lead">
                {draft.roleNotes[r.title]}
              </T>
            ) : null}
          </View>
        ))}
      </Part>
      <Part
        title="Strengths"
        editing={editing === 'superpowers'}
        onEdit={() => edit('superpowers', draft.superpowers.join('\n'))}
      >
        {editing === 'superpowers' ? (
          <>
            {box(5)}
            <T variant="meta" tone="faint">
              One per line.
            </T>
          </>
        ) : (
          draft.superpowers.map((p) => (
            <T key={p} variant="body">
              • {p}
            </T>
          ))
        )}
      </Part>
      <Part
        title="Proof points"
        editing={editing === 'proof'}
        onEdit={() =>
          edit('proof', draft.proofPoints.map((p) => `${p.name} — ${p.metric}`).join('\n'))
        }
      >
        {editing === 'proof' ? (
          <>
            {box(5)}
            <T variant="meta" tone="faint">
              One per line: what it was — the result.
            </T>
          </>
        ) : draft.proofPoints.length ? (
          draft.proofPoints.map((p) => (
            <T key={`${p.name}${p.metric}`} variant="body">
              • <T variant="label">{p.name}</T>
              {p.metric ? ` — ${p.metric}` : ''}
            </T>
          ))
        ) : (
          <T variant="meta" tone="lead">
            None yet. Add results with a number if you have them.
          </T>
        )}
      </Part>
      {study ? (
        <Part title="Places and funding" onEdit={() => void go('want')} editLabel="Change">
          <T variant="body">
            {[
              w.study?.places?.prefer?.length ? `Prefer ${w.study.places.prefer.join(', ')}` : null,
              w.study?.places?.allow?.length ? `also ${w.study.places.allow.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join('; ') || 'Anywhere'}
          </T>
          {w.study?.places?.exclude?.length ? (
            <T variant="body" tone="lead">
              Never {w.study.places.exclude.join(', ')}
            </T>
          ) : null}
          <T variant="body" tone="lead">
            {[
              s.about.nationality,
              w.study?.fundingNeed === 'full' ? 'Full funding only' : 'Any funding level',
              w.study?.englishTest,
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>
        </Part>
      ) : null}
      {study ? null : (
        <Part title="Pay and places" onEdit={() => void go('want')} editLabel="Change">
          <T variant="body">
            {[
              w.salaryTarget ? `Target ${w.salaryTarget}` : null,
              w.salaryMin ? `minimum ${w.salaryMin}` : null,
              w.currency || null,
            ]
              .filter(Boolean)
              .join(', ') || 'No pay given'}
          </T>
          <T variant="body" tone="lead">
            {[
              (w.workTypes ?? []).map((t) => WORK_TYPE_LABELS[t]).join(', '),
              (w.places ?? []).join(', '),
            ]
              .filter(Boolean)
              .join(' · ') || 'No places given'}
          </T>
        </Part>
      )}
      {study ? null : (
        <Part title="Deal-breakers" onEdit={() => void go('want')} editLabel="Change">
          <T variant="body">{(w.dealBreakers ?? []).join(' · ') || 'None'}</T>
        </Part>
      )}
      <Part
        title="The full profile triage and scoring read"
        editing={editing === 'narrative'}
        onEdit={() => edit('narrative', draft.narrative)}
      >
        {editing === 'narrative' ? box(20) : <Markdown text={draft.narrative} compact />}
      </Part>
      <Actions>
        <Button kind="ghost" label="Write it again" onPress={() => void rewrite()} />
        <View style={{ flex: 1 }} />
        <Button
          label="Confirm profile"
          busy={busy}
          disabled={!!editing}
          onPress={() => void confirm()}
        />
      </Actions>
    </View>
  );
}

// ── Sources and first scan ──────────────────────────────────────────────────

function Pick({
  title,
  items,
  picked,
  toggle,
  note,
}: {
  title: string;
  items: { name: string; note?: string }[];
  picked: Set<string>;
  toggle: (name: string) => void;
  note?: string;
}) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: space.md }}>
      <T variant="caps" tone="lead">
        {title} · {items.filter((i) => picked.has(i.name)).length} of {items.length}
      </T>
      {note ? (
        <T variant="meta" tone="faint" style={{ marginTop: 2 }}>
          {note}
        </T>
      ) : null}
      {items.map((i) => (
        <Check
          key={i.name}
          checked={picked.has(i.name)}
          label={i.name}
          note={i.note}
          onToggle={() => toggle(i.name)}
        />
      ))}
    </View>
  );
}

const boardNote = (b: SourceEntry) =>
  [b.provider, b.what_or ?? b.keywords, b.where ?? b.location ?? b.country]
    .filter((x) => typeof x === 'string' && x)
    .join(' · ');

export function SourcesStep({
  s,
  set,
  onFinished,
}: StepProps & { onFinished: (scan: boolean, runs: number) => void }) {
  const sug = s.suggestions;
  const study = s.mode === 'scholarships';
  const run = useRun(s.runs.sources ?? '').data?.run;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<'scan' | 'plain' | null>(null);

  useEffect(() => {
    if (sug && !picked)
      setPicked(
        new Set(
          [...sug.companies, ...sug.careerSites, ...sug.boards, ...sug.queries].map((x) => x.name),
        ),
      );
  }, [sug, picked]);

  const asked = useRef(false);
  useEffect(() => {
    if (sug || s.runs.sources || asked.current) return;
    asked.current = true;
    api.suggestSources().then(set, fail);
  }, [sug, s.runs.sources, set]);

  const toggle = (name: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const finish = async (scan: boolean) => {
    setBusy(scan ? 'scan' : 'plain');
    try {
      const only = (xs: { name: string }[] | undefined) =>
        (xs ?? []).filter((x) => picked?.has(x.name)).map((x) => x.name);
      const out = await api.finishSetup({
        companies: only([...(sug?.companies ?? []), ...(sug?.careerSites ?? [])]),
        boards: only(sug?.boards),
        queries: only(sug?.queries),
        scan,
      });
      for (const r of out.runs) applyRun(r);
      set(out.setup);
      onFinished(scan, out.runs.length);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  if (!sug)
    return (
      <View>
        <Title
          lead={
            study
              ? 'Winnow picks the schemes, university award pages and feeds it knows that suit you, and AI looks for more for your subjects and places, then checks each page.'
              : 'AI looks for employers, job-board searches and web searches that fit your roles and places, then checks each careers page.'
          }
        >
          {study ? 'Where your scholarships come from' : 'Where your jobs come from'}
        </Title>
        <SetupRun
          id={s.runs.sources}
          label="Finding sources for you"
          onRetry={() => void api.suggestSources().then(set, fail)}
        />
        <T variant="meta" tone="lead">
          {run && ACTIVE.has(run.status)
            ? 'This takes a couple of minutes. You can skip it and add sources in Find later.'
            : ''}
        </T>
        <Actions>
          <Button
            kind="secondary"
            label="Skip for now"
            busy={busy === 'plain'}
            onPress={() => void finish(false)}
          />
        </Actions>
      </View>
    );

  const scannable = [...sug.companies, ...sug.boards].some((x) => picked?.has(x.name));
  return (
    <View>
      <Title lead="Untick anything you don’t want. You can change all of this in Find.">
        {study ? 'Where your scholarships come from' : 'Where your jobs come from'}
      </Title>
      <Pick
        title={study ? 'Pages to watch' : 'Employers'}
        items={sug.companies.map((c) => ({ name: c.name, note: c.notes }))}
        picked={picked ?? new Set()}
        toggle={toggle}
        note={
          study
            ? `Scheme and university pages, read on every scan; a change means a new round. Free.${
                sug.dropped.length
                  ? ` Left out because their link didn’t work: ${sug.dropped.join(', ')}.`
                  : ''
              }`
            : 'Read directly in every Portals scan. Free.'
        }
      />
      <Pick
        title="Employers’ own careers sites"
        items={sug.careerSites.map((c) => ({ name: c.name, note: c.notes }))}
        picked={picked ?? new Set()}
        toggle={toggle}
        note={`No scanner reads these; AI search does, when you run it from Find.${
          sug.dropped.length
            ? ` Left out because their link didn’t work: ${sug.dropped.join(', ')}.`
            : ''
        }`}
      />
      <Pick
        title={study ? 'News feeds' : 'Job-board searches'}
        items={sug.boards.map((b) => ({ name: b.name, note: boardNote(b) }))}
        picked={picked ?? new Set()}
        toggle={toggle}
      />
      <Pick
        title={study ? 'AI searches' : 'AI search queries'}
        items={sug.queries.map((q) => ({ name: q.name, note: q.query }))}
        picked={picked ?? new Set()}
        toggle={toggle}
        note="Used by AI search, which you start from Find. It uses tokens."
      />
      {sug.titles.positive.length ? (
        <View style={{ marginTop: space.md, gap: 4 }}>
          <T variant="caps" tone="lead">
            Title words added to your rules
          </T>
          <T variant="meta" tone="lead">
            Keep: {sug.titles.positive.join(', ')}
          </T>
          {sug.titles.negative.length ? (
            <T variant="meta" tone="lead">
              Skip: {sug.titles.negative.join(', ')}
            </T>
          ) : null}
        </View>
      ) : null}
      <Actions>
        <Button
          kind="ghost"
          label="Finish without scanning"
          busy={busy === 'plain'}
          onPress={() => void finish(false)}
        />
        <Button
          label="Start first scan"
          icon="travel-explore"
          busy={busy === 'scan'}
          disabled={!scannable}
          hint={
            !scannable
              ? study
                ? 'Tick a page or a feed to scan.'
                : 'Tick an employer or a board to scan.'
              : 'Free. Triage runs on what it finds.'
          }
          onPress={() => void finish(true)}
        />
      </Actions>
    </View>
  );
}
