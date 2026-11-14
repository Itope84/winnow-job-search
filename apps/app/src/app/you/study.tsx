import type { Referee, StudyPrefs } from '@winnow/api';
import { EMPTY_STUDY } from '@winnow/api';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { DocEditor } from '@/components/DocEditor';
import { Input } from '@/components/inputs';
import { StudyForm } from '@/components/StudyForm';
import { Button, Header, Icon, Loading, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { pickPdf } from '@/lib/files';
import { useReferees, useStudy } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

function Statement() {
  const { c } = useTheme();
  const [sending, setSending] = useState(false);
  const upload = async () => {
    const file = await pickPdf();
    if (!file) return;
    setSending(true);
    try {
      const out = await api.uploadStatementPdf(file, file.name);
      queryClient.setQueryData(keys.profile, out);
      toast.show('Saved your document');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <T variant="bodySmall" tone="lead">
        A personal statement or cover letter in your own words. Profile drafts, essays and
        motivation letters keep your voice from it.
      </T>
      {Platform.OS === 'web' ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            kind="secondary"
            icon="upload-file"
            label="Upload a PDF"
            busy={sending}
            onPress={() => void upload()}
          />
        </View>
      ) : null}
      <View style={{ borderTopWidth: 1, borderTopColor: c.rule }} />
      <DocEditor field="statement" hint="Kept as written. Edit freely." />
    </View>
  );
}

function Referees() {
  const { c } = useTheme();
  const q = useReferees();
  const [list, setList] = useState<Referee[]>([]);
  useEffect(() => {
    if (q.data) setList(q.data);
  }, [q.data]);
  const save = async (next: Referee[]) => {
    setList(next);
    try {
      queryClient.setQueryData(keys.referees, await api.saveReferees(next));
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [contact, setContact] = useState('');
  return (
    <View style={{ gap: space.sm }}>
      <T variant="bodySmall" tone="lead">
        Most applications want two or three. Ask early: some schemes write to referees directly.
      </T>
      {list.map((r) => (
        <View
          key={r.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 10,
            borderRadius: radius.base,
            backgroundColor: c.surface,
          }}
        >
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: r.agreed }}
            accessibilityLabel={`${r.name} agreed`}
            onPress={() =>
              void save(list.map((x) => (x.id === r.id ? { ...x, agreed: !x.agreed } : x)))
            }
          >
            <Icon
              name={r.agreed ? 'check-circle' : 'radio-button-unchecked'}
              tone={r.agreed ? 'sage' : 'faint'}
            />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T variant="label">{r.name}</T>
            <T variant="meta" tone="lead">
              {[r.role, r.contact, r.agreed ? 'Agreed' : 'Not asked yet']
                .filter(Boolean)
                .join(' · ')}
            </T>
          </View>
          <Pressable
            onPress={() => void save(list.filter((x) => x.id !== r.id))}
            accessibilityLabel={`Remove ${r.name}`}
          >
            <Icon name="close" size={18} tone="faint" />
          </Pressable>
        </View>
      ))}
      <Input value={name} onChangeText={setName} placeholder="Name" />
      <Input
        value={role}
        onChangeText={setRole}
        placeholder="Role (Thesis supervisor, Head of department)"
      />
      <Input value={contact} onChangeText={setContact} placeholder="Email" autoCapitalize="none" />
      <View style={{ flexDirection: 'row' }}>
        <Button
          kind="secondary"
          label="Add referee"
          disabled={!name.trim()}
          onPress={() => {
            void save([
              ...list,
              {
                id: '',
                name: name.trim(),
                role: role.trim(),
                contact: contact.trim(),
                agreed: false,
              },
            ]);
            setName('');
            setRole('');
            setContact('');
          }}
        />
      </View>
    </View>
  );
}

export default function Study() {
  const q = useStudy();
  const [draft, setDraft] = useState<StudyPrefs>(EMPTY_STUDY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data);
  }, [q.data, dirty]);
  const save = async () => {
    setSaving(true);
    try {
      queryClient.setQueryData(keys.study, await api.saveStudy(draft));
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.coverage });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      setDirty(false);
      toast.show('Saved. New scans and scores use it.');
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Screen
      header={<Header title="Study preferences" />}
      footer={
        dirty ? (
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}>
            <Button label="Save changes" busy={saving} onPress={() => void save()} />
          </View>
        ) : null
      }
    >
      {!q.data ? (
        <Loading />
      ) : (
        <View style={{ paddingTop: space.md }}>
          <StudyForm
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setDirty(true);
            }}
          />
          <SectionTitle>In your own words</SectionTitle>
          <Statement />
          <SectionTitle>Referees</SectionTitle>
          <Referees />
        </View>
      )}
    </Screen>
  );
}
