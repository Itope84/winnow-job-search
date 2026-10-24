import { useQuery } from '@tanstack/react-query';
import type { JackDraft, JackEdit, JackOverview } from '@winnow/api';
import { RUN_COSTS } from '@winnow/api';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Check, Input } from '@/components/inputs';
import { RunCard } from '@/components/runs';
import { Button, Header, Loading, Notice, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { dateLabel } from '@/lib/format';
import { useActiveRuns, useJack, useSettings, useStartRun } from '@/lib/hooks';
import { applyRun, keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

/**
 * Link a Jack (Jack & Jill) account. Jack only sends people back to a loopback address, which can't load
 * on their device, so they copy that page's address and paste it here. The server finishes the sign-in.
 */
export default function Jack() {
  const jack = useJack();
  return (
    <Screen header={<Header title="Jack & Jill" />}>
      <View style={{ paddingTop: space.md }}>
        <T variant="bodySmall" tone="lead">
          Jack is a free AI recruiter from Jack & Jill. Connect your Jack account and Winnow can
          search the jobs Jack finds, including roles companies hire for through Jill.
        </T>
        {jack.isLoading ? (
          <Loading />
        ) : jack.data?.connected ? (
          <Connected connectedAt={jack.data.connectedAt} problem={jack.data.problem} />
        ) : (
          <Connect />
        )}
      </View>
    </Screen>
  );
}

function Step({ n, children }: { n: number; children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.sm }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: c.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <T variant="meta" style={{ color: c.primaryInk }}>
          {String(n)}
        </T>
      </View>
      <T variant="bodySmall" style={{ flex: 1 }}>
        {children}
      </T>
    </View>
  );
}

function Connect() {
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pasted, setPasted] = useState('');
  const [finishing, setFinishing] = useState(false);

  const open = async () => {
    // Open the tab inside the tap, then point it at the link: browsers block tabs opened later.
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    setOpening(true);
    try {
      const { url } = await api.jackStart();
      if (tab) tab.location.href = url;
      else await Linking.openURL(url);
      setOpened(true);
    } catch (e) {
      tab?.close();
      toast.show((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const finish = async (text: string) => {
    if (!text.trim()) return;
    setFinishing(true);
    try {
      const status = await api.jackFinish(text);
      queryClient.setQueryData(keys.jack, status);
      toast.show('Jack is connected');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setFinishing(false);
    }
  };

  const pasteAndFinish = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text) {
      toast.show('Nothing to paste. Copy the address first, or paste it into the box.');
      return;
    }
    setPasted(text);
    await finish(text);
  };

  return (
    <>
      <SectionTitle>Connect in four steps</SectionTitle>
      <Step n={1}>
        Tap Open Jack sign-in below and continue with LinkedIn. No Jack account yet? This makes one,
        and you can skip the chat with Jack.
      </Step>
      <Step n={2}>
        Approve the connection. Jack’s page may say “Connect Jack to ChatGPT”: that’s its wording
        for any app, and here it means Winnow.
      </Step>
      <Step n={3}>
        You’ll land on a page that won’t load, saying it can’t connect or the site can’t be reached.
        That’s expected: the page’s address carries your sign-in code.
      </Step>
      <Step n={4}>
        Copy that page’s address (it starts with http://127.0.0.1) and come back here to paste it.
        Do it straight away: the code only works for a few minutes.
      </Step>
      <View style={{ flexDirection: 'row', marginTop: space.sm, marginBottom: space.md }}>
        <Button
          label={opened ? 'Open Jack sign-in again' : 'Open Jack sign-in'}
          icon="open-in-new"
          kind={opened ? 'secondary' : 'primary'}
          busy={opening}
          onPress={() => void open()}
        />
      </View>
      {opened ? (
        <>
          <SectionTitle>Paste the address</SectionTitle>
          <Input
            value={pasted}
            onChangeText={setPasted}
            placeholder="http://127.0.0.1:8899/jack/callback?code=…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button
              label="Paste and connect"
              icon="content-paste"
              busy={finishing}
              onPress={() => void pasteAndFinish()}
            />
            <Button
              kind="secondary"
              label="Connect"
              disabled={!pasted.trim()}
              busy={finishing}
              onPress={() => void finish(pasted)}
            />
          </View>
        </>
      ) : null}
      <T variant="meta" tone="faint" style={{ marginTop: space.lg }}>
        Winnow gets access to your Jack profile, search brief and job search. It never changes
        anything in Jack without asking you first. Disconnect here at any time.
      </T>
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  role_titles: 'Roles',
  role_areas: 'Areas',
  seniority_levels: 'Seniority',
  employment_types: 'Employment',
  locations: 'Places',
  work_modes: 'Work modes',
  location_notes: 'About places',
  right_to_work_countries: 'Right to work',
  languages: 'Languages',
  pay: 'Pay',
  compensation_notes: 'About pay',
  role_priorities: 'What matters most',
  industries: 'Industries',
  sectors_notes: 'About sectors',
  technologies: 'Technologies',
  skills_notes: 'About skills',
  company_profile: 'Kind of company',
  target_companies: 'Target companies',
  excluded_role_titles: 'Not these roles',
  excluded_industries: 'Not these industries',
  excluded_companies: 'Not these companies',
  excluded_technologies: 'Not these technologies',
  headline: 'Headline',
  summary: 'Summary',
  detailed_summary: 'Longer summary',
  looking_for: 'Looking for',
  location: 'Location',
  skills: 'Skills',
  experiences: 'Experience',
  education: 'Education',
};

const words = (fields: string[]) =>
  fields.map((f) => (FIELD_LABELS[f] ?? f.replace(/_/g, ' ')).toLowerCase()).join(', ');

function OnJack({ account }: { account: NonNullable<JackOverview['account']> }) {
  const lines = [
    account.briefEmpty
      ? 'Search brief: empty, so Jack’s search can’t run yet'
      : account.briefMissing.length
        ? `Search brief: missing ${words(account.briefMissing)}`
        : 'Search brief: complete',
    account.profileMissing.length
      ? `Profile: missing ${words(account.profileMissing)}`
      : 'Profile: complete',
    account.visible
      ? `Visible to Jill${account.radar ? ', with Jill roles on your radar' : ''}`
      : 'Hidden from Jill: no Jill roles until you’re visible on Jack',
  ];
  return (
    <View style={{ gap: 4 }}>
      {lines.map((l) => (
        <T key={l} variant="bodySmall" tone="lead">
          {l}
        </T>
      ))}
    </View>
  );
}

function EditRow({
  edit,
  checked,
  onToggle,
  onSave,
}: {
  edit: JackEdit;
  checked: boolean;
  onToggle: () => void;
  onSave: (text: string) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label =
    edit.field === 'experiences' || edit.field === 'education'
      ? `${FIELD_LABELS[edit.field]}: ${edit.entry ?? edit.why}`
      : (FIELD_LABELS[edit.field] ?? edit.field);
  const save = async () => {
    if (text == null) return;
    setSaving(true);
    if (await onSave(text)) setText(null);
    setSaving(false);
  };
  return (
    <View style={{ marginBottom: space.md }}>
      <Check checked={checked} label={label} note={edit.why} onToggle={onToggle} />
      <View style={{ marginLeft: 34, gap: 4 }}>
        {text != null ? (
          <>
            <Input area value={text} onChangeText={setText} autoFocus />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button kind="secondary" label="Save" busy={saving} onPress={() => void save()} />
              <Button kind="ghost" label="Cancel" onPress={() => setText(null)} />
            </View>
          </>
        ) : (
          <>
            <T variant="bodySmall" numberOfLines={8}>
              {edit.after}
            </T>
            {edit.problem ? (
              <T variant="meta" style={{ color: c.dangerText }}>
                Jack refused this: {edit.problem}
              </T>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <T variant="meta" tone="faint" numberOfLines={2} style={{ flex: 1 }}>
                {edit.before ? `Now on Jack: ${edit.before}` : 'Empty on Jack now'}
              </T>
              <Button kind="ghost" label="Edit" icon="edit" onPress={() => setText(edit.after)} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function Draft({
  draft,
  onDone,
  onRedraft,
}: {
  draft: JackDraft;
  onDone: (o: JackOverview) => void;
  onRedraft: () => void;
}) {
  const [brief, setBrief] = useState(() => draft.brief.map(() => true));
  const [profile, setProfile] = useState(() => draft.profile.map(() => true));
  const [busy, setBusy] = useState<'send' | 'discard' | null>(null);
  const count = brief.filter(Boolean).length + profile.filter(Boolean).length;
  const pick = (list: boolean[]) => list.flatMap((v, i) => (v ? [i] : []));
  const send = async () => {
    setBusy('send');
    try {
      const out = await api.jackApply({ brief: pick(brief), profile: pick(profile) });
      toast.show(
        out.failed.length
          ? `Sent ${out.sent}. Jack refused ${out.failed.length}: edit ${out.failed.length === 1 ? 'it' : 'them'} and send again.`
          : `Sent ${out.sent} change${out.sent === 1 ? '' : 's'} to Jack`,
      );
      onDone(out.overview);
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = (part: 'brief' | 'profile', index: number) => async (text: string) => {
    try {
      onDone(await api.jackEditDraft({ part, index, text }));
      return true;
    } catch (e) {
      toast.show((e as Error).message);
      return false;
    }
  };
  const discard = async () => {
    setBusy('discard');
    try {
      onDone(await api.jackDiscard());
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!draft.brief.length && !draft.profile.length)
    return (
      <Notice tone="info" icon="check-circle" title="Jack already matches your Winnow profile" />
    );
  const refused = [...draft.brief, ...draft.profile].filter((e) => e.problem).length;
  return (
    <>
      {refused ? (
        <Notice
          tone="warning"
          icon="warning-amber"
          title={`Jack refused ${refused} change${refused === 1 ? '' : 's'}`}
          body="Its reason is under each one. Edit them, then send again."
        />
      ) : null}
      {draft.brief.length ? (
        <>
          <SectionTitle>Search brief (private)</SectionTitle>
          {draft.brief.map((e, i) => (
            <EditRow
              key={`b${e.field}`}
              edit={e}
              checked={brief[i] ?? false}
              onToggle={() => setBrief((b) => b.map((v, j) => (j === i ? !v : v)))}
              onSave={save('brief', i)}
            />
          ))}
        </>
      ) : null}
      {draft.profile.length ? (
        <>
          <SectionTitle>Profile (hiring managers see this)</SectionTitle>
          {draft.profile.map((e, i) => (
            <EditRow
              key={`p${e.field}${e.itemKey ?? ''}`}
              edit={e}
              checked={profile[i] ?? false}
              onToggle={() => setProfile((p) => p.map((v, j) => (j === i ? !v : v)))}
              onSave={save('profile', i)}
            />
          ))}
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Button
          label={`Send ${count} to Jack`}
          icon="send"
          disabled={!count}
          busy={busy === 'send'}
          onPress={() => void send()}
        />
        <Button kind="ghost" label="Draft again" icon="refresh" onPress={onRedraft} />
        <Button
          kind="ghost"
          label="Discard"
          busy={busy === 'discard'}
          onPress={() => void discard()}
        />
      </View>
    </>
  );
}

function Connected({
  connectedAt,
  problem,
}: {
  connectedAt: string | null;
  problem: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const active = useActiveRuns().data ?? [];
  const drafting = active.find((r) => r.kind === 'jack_update');
  const scanning = active.find((r) => r.kind === 'scan_jack');
  const info = useQuery({
    queryKey: keys.jackOverview,
    queryFn: api.jackOverview,
    // While a draft is being written, check for it.
    refetchInterval: drafting ? 3000 : false,
  });
  const start = useStartRun();
  const settings = useSettings().data;
  const draft = info.data?.draft;
  // A draft run just ended: fetch what it wrote.
  const draftingId = drafting?.id;
  const wasDrafting = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (wasDrafting.current && !draftingId)
      void queryClient.invalidateQueries({ queryKey: keys.jackOverview });
    wasDrafting.current = draftingId;
  }, [draftingId]);
  const disconnect = async () => {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.jack, await api.jackDisconnect());
      void queryClient.invalidateQueries({ queryKey: keys.jackOverview });
      toast.show('Jack is disconnected');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startDraft = async () => {
    try {
      const runs = await api.jackDraft();
      for (const r of runs) applyRun(r);
      void queryClient.invalidateQueries({ queryKey: keys.activeRuns });
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  return (
    <>
      {problem ? (
        <Notice
          tone="warning"
          icon="warning-amber"
          title="Jack needs reconnecting"
          body={problem}
        />
      ) : (
        <Notice
          tone="info"
          icon="check-circle"
          title="Connected"
          body={connectedAt ? `Since ${dateLabel(connectedAt)}` : null}
        />
      )}

      <SectionTitle
        right={
          <Button
            kind="ghost"
            label="Refresh"
            icon="refresh"
            busy={info.isFetching}
            onPress={() => void info.refetch()}
          />
        }
      >
        On Jack
      </SectionTitle>
      {info.isLoading ? (
        <Loading />
      ) : info.data?.account ? (
        <OnJack account={info.data.account} />
      ) : (
        <T variant="bodySmall" tone="lead">
          Couldn’t reach Jack just now.
        </T>
      )}

      <SectionTitle>Update Jack</SectionTitle>
      {drafting ? (
        <RunCard run={drafting} compact />
      ) : draft ? (
        <Draft
          key={`${draft.createdAt}-${draft.brief.length}-${draft.profile.length}`}
          draft={draft}
          onDone={(o) => queryClient.setQueryData(keys.jackOverview, o)}
          onRedraft={() => void startDraft()}
        />
      ) : (
        <>
          <T variant="bodySmall" tone="lead">
            Winnow drafts your Jack search brief and fills gaps in your Jack profile from your
            Winnow profile and CV. You check every change before it’s sent.
          </T>
          <View style={{ flexDirection: 'row', marginTop: space.sm }}>
            <Button
              kind="secondary"
              icon="edit-note"
              label="Draft an update"
              onPress={() => void startDraft()}
            />
          </View>
          <T variant="meta" tone="faint" style={{ marginTop: 4 }}>
            Uses tokens · {RUN_COSTS.jack_update.estimate}
          </T>
        </>
      )}

      <SectionTitle>Scan</SectionTitle>
      <T variant="bodySmall" tone="lead">
        A Jack scan adds the Jill roles on your radar, and Jack’s search on your brief, to your
        Inbox. It’s also in Find › Scans.
      </T>
      {scanning ? (
        <RunCard run={scanning} compact />
      ) : (
        <View style={{ flexDirection: 'row', marginTop: space.sm }}>
          <Button
            label="Scan Jack now"
            icon="travel-explore"
            busy={start.isPending}
            onPress={() =>
              start.mutate(
                { kind: 'scan_jack', options: { autoTriage: settings?.autoTriage ?? true } },
                { onSuccess: () => toast.show('Jack scan started') },
              )
            }
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', marginTop: space.xl }}>
        <Button
          kind="danger"
          label={problem ? 'Disconnect, then connect again' : 'Disconnect'}
          busy={busy}
          onPress={() => void disconnect()}
        />
      </View>
    </>
  );
}
