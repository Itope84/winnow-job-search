import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Input } from '@/components/inputs';
import { Button, Field, Loading, Notice, T } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
import { space, type, useTheme } from '@/theme';

/** An invite link: set a password and go straight in. Also how a forgotten password is reset. */
export default function Welcome() {
  const { c } = useTheme();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const info = useQuery({
    queryKey: ['invite', invite],
    queryFn: () => api.invite(invite ?? ''),
    enabled: !!invite,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password !== again) return setError('The two passwords don’t match.');
    setBusy(true);
    setError(null);
    try {
      const me = await api.accept(invite ?? '', password);
      queryClient.setQueryData(keys.me, me);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.canvas,
        justifyContent: 'center',
        alignItems: 'center',
        padding: space.md,
      }}
    >
      <View style={{ width: '100%', maxWidth: 380, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={{ width: 44, height: 44, borderRadius: 11 }}
          />
          <Text style={[type.display, { color: c.ink }]}>winnow</Text>
        </View>
        {!invite ? (
          <Notice
            tone="warning"
            title="This page needs an invite link."
            action={
              <Button
                kind="secondary"
                label="Go to sign in"
                onPress={() => router.replace('/signin')}
              />
            }
          />
        ) : info.isLoading ? (
          <Loading />
        ) : info.error ? (
          <Notice
            tone="danger"
            title={(info.error as Error).message}
            body="Ask for a new invite link."
            action={
              <Button
                kind="secondary"
                label="Go to sign in"
                onPress={() => router.replace('/signin')}
              />
            }
          />
        ) : (
          <>
            <T variant="title">Welcome, {info.data?.name}</T>
            <T variant="body" tone="lead">
              Your username is {info.data?.username}. Choose a password of at least 10 characters.
            </T>
            {error ? <Notice tone="danger" title={error} /> : null}
            <Field label="Password">
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                autoFocus
              />
            </Field>
            <Field label="Password again">
              <Input
                value={again}
                onChangeText={setAgain}
                secureTextEntry
                autoComplete="new-password"
                onSubmitEditing={() => void submit()}
              />
            </Field>
            <Button
              label="Set password and continue"
              busy={busy}
              disabled={password.length < 10 || !again}
              onPress={() => void submit()}
            />
          </>
        )}
      </View>
    </View>
  );
}
