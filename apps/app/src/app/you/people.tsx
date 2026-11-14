import { useQuery } from '@tanstack/react-query';
import type { Mode } from '@winnow/api';
import { MODE_LABELS } from '@winnow/api';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { View } from 'react-native';
import { Chip } from '@/components/chips';
import { Input, Segmented } from '@/components/inputs';
import {
  Button,
  Field,
  Header,
  Loading,
  Notice,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { api, inviteLink } from '@/lib/api';
import { keys } from '@/lib/query';
import { toast } from '@/lib/toast';
import { space } from '@/theme';

/** Admins invite people and reset sign-ins. Nothing is emailed: copy the link and send it yourself. */
export default function People() {
  const people = useQuery({ queryKey: keys.people, queryFn: api.people });
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('jobs');
  const [link, setLink] = useState<string | null>(null);

  const share = async (token: string) => {
    const url = inviteLink(token);
    setLink(url);
    await Clipboard.setStringAsync(url).catch(() => {});
    toast.show('Invite link copied');
  };

  return (
    <Screen header={<Header title="People" />}>
      <View style={{ paddingTop: space.md }}>
        <T variant="bodySmall" tone="lead">
          Each person gets their own jobs, CV and settings. Invite links work once and last 14 days.
          A new link also resets a forgotten password.
        </T>
        {link ? <Notice tone="info" title="Invite link (copied)" body={link} /> : null}
        <SectionTitle>Invite someone</SectionTitle>
        <Field label="Name">
          <Input value={name} onChangeText={setName} />
        </Field>
        <Field label="Email">
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </Field>
        <Field
          label="Username"
          hint="Lower-case letters, digits and dashes. They sign in with this or their email."
        >
          <Input
            value={id}
            onChangeText={(v) => setId(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            autoCapitalize="none"
          />
        </Field>
        <Field label="Looking for" hint="They confirm it on the first setup screen.">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'jobs', label: 'Jobs' },
              { value: 'scholarships', label: 'Scholarships' },
            ]}
          />
        </Field>
        <Button
          label="Create invite"
          disabled={!id || !email}
          onPress={() =>
            void api.addPerson({ id, email, name, mode }).then(
              (r) => {
                void people.refetch();
                setId('');
                setEmail('');
                setName('');
                setMode('jobs');
                void share(r.invite);
              },
              (e) => toast.show((e as Error).message),
            )
          }
        />
        <SectionTitle>Everyone</SectionTitle>
        {people.isLoading ? (
          <Loading />
        ) : (
          (people.data ?? []).map((p) => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={`${p.id} · ${p.email} · ${MODE_LABELS[p.mode ?? 'jobs']}`}
              meta={
                <Chip
                  label={
                    p.disabled
                      ? 'Disabled'
                      : !p.hasPassword
                        ? 'Invited'
                        : p.admin
                          ? 'Admin'
                          : 'Member'
                  }
                  tone={p.hasPassword ? 'neutral' : 'amber'}
                />
              }
              trailing={
                <Button
                  kind="ghost"
                  label="New link"
                  onPress={() =>
                    void api.reinvite(p.id).then(
                      (r) => share(r.invite),
                      (e) => toast.show((e as Error).message),
                    )
                  }
                />
              }
            />
          ))
        )}
      </View>
    </Screen>
  );
}
